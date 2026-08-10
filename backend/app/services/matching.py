from __future__ import annotations

import math
import re
import unicodedata
from pathlib import Path
from typing import Any, Iterable, List, Optional, Sequence

from rapidfuzz import fuzz
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    Document,
    Item,
    Job,
    LearnedMatch,
    MatchMethod,
    ProductIndex,
    ReviewStatus,
)
from app.models.job import utc_now
from app.schemas.documents import ItemRead, ProductCandidate, RegisterProductRequest
from app.services.excel import ExcelValidationError, product_sheet_max_row, sha256_file
from app.services.item_rules import ItemRuleError, validate_item_state
from app.services.job_mutations import lock_job_for_mutation


AUTO_MATCH_SCORE = 0.90
MAX_CANDIDATES = 5
_TOKEN_PATTERN = re.compile(
    r"\d+(?:\.\d+)?(?:mg|mcg|g|ml|l|iu|정|캡슐|포|병|개|pen)|"
    r"[가-힣]{2,}|[a-z]{2,}",
    re.IGNORECASE,
)


class MatchingOperationError(ValueError):
    pass


def normalize_text(value: Optional[str]) -> str:
    if value is None:
        return ""
    normalized = unicodedata.normalize("NFKC", str(value)).casefold()
    return "".join(character for character in normalized if character.isalnum())


def similarity_score(
    query_name: Optional[str],
    query_specification: Optional[str],
    product_name: Optional[str],
    product_specification: Optional[str],
) -> float:
    query = normalize_text(f"{query_name or ''} {query_specification or ''}")
    product = normalize_text(
        f"{product_name or ''} {product_specification or ''}"
    )
    if not query or not product:
        return 0.0
    if query == product:
        return 1.0

    score = max(fuzz.ratio(query, product), fuzz.WRatio(query, product)) / 100
    semantic = _semantic_coverage_score(
        query_name,
        query_specification,
        product_name,
        product_specification,
    )
    return round(min(1.0, max(score, semantic)), 6)


def should_auto_match(
    candidate_scores: Sequence[float],
) -> bool:
    return (
        sum(score + 1e-9 >= AUTO_MATCH_SCORE for score in candidate_scores)
        == 1
    )


def rank_product_candidates(
    products: Sequence[ProductIndex],
    *,
    product_code_or_barcode: Optional[str],
    product_name: Optional[str],
    specification: Optional[str],
    unit_price: Optional[int],
    limit: int = MAX_CANDIDATES,
) -> List[ProductCandidate]:
    query_code = normalize_text(product_code_or_barcode)
    query_combined = normalize_text(f"{product_name or ''} {specification or ''}")
    ranked: list[tuple[int, float, float, int, ProductCandidate]] = []

    for product in products:
        product_combined = normalize_text(
            f"{product.product_name or ''} {product.specification or ''}"
        )
        if query_code and query_code == normalize_text(product.product_code):
            method = MatchMethod.CODE
            score = 1.0
            method_priority = 3
        elif query_combined and query_combined == product_combined:
            method = MatchMethod.NORMALIZED_NAME_SPEC
            score = 1.0
            method_priority = 2
        else:
            method = MatchMethod.SIMILARITY
            method_priority = 1
            score = similarity_score(
                product_name,
                specification,
                product.product_name,
                product.specification,
            )

        price_similarity = _price_similarity(
            unit_price, _optional_integer(product.purchase_price)
        )
        # 가격은 텍스트 점수를 바꾸지 않고, 동점에 가까운 후보의 순위에만
        # 최대 0.02만큼 보조 신호로 사용합니다.
        rank_score = score + 0.02 * (price_similarity or 0.0)
        candidate = ProductCandidate(
            product_code=product.product_code,
            product_name=product.product_name,
            specification=product.specification,
            supplier_code=product.supplier_code,
            supplier=product.supplier,
            current_stock=_optional_integer(product.current_stock),
            purchase_price=_optional_integer(product.purchase_price),
            excel_row=product.excel_row,
            match_method=method,
            score=score,
            price_similarity=price_similarity,
        )
        ranked.append(
            (method_priority, rank_score, score, product.excel_row, candidate)
        )

    ranked.sort(key=lambda value: (-value[0], -value[1], -value[2], value[3]))
    return [value[4] for value in ranked[: max(0, min(limit, MAX_CANDIDATES))]]


def recalculate_item_match(
    db: Session,
    item: Item,
    products: Optional[Sequence[ProductIndex]] = None,
    *,
    preserve_manual: bool = True,
    preserve_purchase_price: bool = True,
    auto_approve: bool = False,
) -> None:
    job_id = item.document.job_id
    previous_product_code = item.matched_product_code
    product_rows = list(products) if products is not None else _job_products(db, job_id)
    candidates = rank_product_candidates(
        product_rows,
        product_code_or_barcode=item.product_code_or_barcode,
        product_name=item.product_name,
        specification=item.specification,
        unit_price=item.unit_price,
    )
    item.match_candidates = [
        candidate.model_dump(mode="json") for candidate in candidates
    ]

    if preserve_manual and item.match_method == MatchMethod.MANUAL:
        selected = next(
            (
                product
                for product in product_rows
                if product.product_code == item.matched_product_code
            ),
            None,
        )
        if selected is not None:
            _apply_product(
                item,
                selected,
                MatchMethod.MANUAL,
                None,
                preserve_purchase_price=(
                    preserve_purchase_price
                    and previous_product_code == selected.product_code
                ),
            )
            return

    remembered = _remembered_product(db, item, product_rows)
    if remembered is not None:
        _apply_product(
            item,
            remembered,
            MatchMethod.MANUAL,
            None,
            preserve_purchase_price=(
                preserve_purchase_price
                and previous_product_code == remembered.product_code
            ),
        )
        _auto_approve_item(item, enabled=auto_approve)
        return

    exact_codes = [
        product
        for product in product_rows
        if normalize_text(item.product_code_or_barcode)
        and normalize_text(item.product_code_or_barcode)
        == normalize_text(product.product_code)
    ]
    if len(exact_codes) == 1:
        _apply_product(
            item,
            exact_codes[0],
            MatchMethod.CODE,
            1.0,
            preserve_purchase_price=(
                preserve_purchase_price
                and previous_product_code == exact_codes[0].product_code
            ),
        )
        _auto_approve_item(item, enabled=auto_approve)
        return

    if not candidates:
        clear_item_match_fields(item)
        return

    product_by_code = {product.product_code: product for product in product_rows}
    if should_auto_match([candidate.score for candidate in candidates]):
        automatic_candidate = next(
            candidate
            for candidate in candidates
            if candidate.score + 1e-9 >= AUTO_MATCH_SCORE
        )
        selected = product_by_code[automatic_candidate.product_code]
        _apply_product(
            item,
            selected,
            automatic_candidate.match_method,
            automatic_candidate.score,
            preserve_purchase_price=(
                preserve_purchase_price
                and previous_product_code == selected.product_code
            ),
        )
        _auto_approve_item(item, enabled=auto_approve)
    else:
        clear_item_match_fields(item)


def match_job_items(db: Session, job: Job) -> List[ItemRead]:
    _ensure_mutable(db, job)
    products = _job_products(db, job.id)
    if not products:
        raise MatchingOperationError(
            "상품리스트가 비어 있습니다. Excel 파일을 먼저 업로드해 주세요."
        )
    items = db.scalars(
        select(Item)
        .join(Document, Item.document_id == Document.id)
        .where(Document.job_id == job.id)
        .order_by(Document.source_order, Item.source_row_order)
    ).all()
    try:
        for item in items:
            recalculate_item_match(db, item, products, auto_approve=True)
            validate_item_state(item)
        _recalculate_reviews(db, items)
        db.commit()
    except ItemRuleError as exc:
        db.rollback()
        raise MatchingOperationError(str(exc)) from exc
    for item in items:
        db.refresh(item)
    return [ItemRead.model_validate(item) for item in items]


def manually_match_item(
    db: Session, item: Item, product_code: str, *, approve: bool = False
) -> ItemRead:
    _ensure_mutable(db, item.document.job)
    product = db.scalar(
        select(ProductIndex).where(
            ProductIndex.job_id == item.document.job_id,
            ProductIndex.product_code == product_code,
        )
    )
    if product is None:
        raise MatchingOperationError("선택한 상품을 현재 상품리스트에서 찾을 수 없습니다.")
    previous_product_code = item.matched_product_code
    try:
        products = _job_products(db, item.document.job_id)
        candidates = rank_product_candidates(
            products,
            product_code_or_barcode=item.product_code_or_barcode,
            product_name=item.product_name,
            specification=item.specification,
            unit_price=item.unit_price,
        )
        item.match_candidates = [
            candidate.model_dump(mode="json") for candidate in candidates
        ]
        _apply_product(
            item,
            product,
            MatchMethod.MANUAL,
            None,
            preserve_purchase_price=(
                previous_product_code == product.product_code
            ),
        )
        _learn_item_match(db, item, product.product_code)
        _auto_approve_item(item, enabled=approve)
        validate_item_state(item)
        item.updated_at = utc_now()
        _recalculate_reviews(db, [item])
        db.commit()
    except ItemRuleError as exc:
        db.rollback()
        raise MatchingOperationError(str(exc)) from exc
    db.refresh(item)
    return ItemRead.model_validate(item)


def clear_item_match(db: Session, item: Item) -> ItemRead:
    _ensure_mutable(db, item.document.job)
    try:
        if item.match_method == MatchMethod.MANUAL and item.matched_product_code:
            _forget_item_match(db, item, item.matched_product_code)
        clear_item_match_fields(item)
        validate_item_state(item)
        item.updated_at = utc_now()
        _recalculate_reviews(db, [item])
        db.commit()
    except ItemRuleError as exc:
        db.rollback()
        raise MatchingOperationError(str(exc)) from exc
    db.refresh(item)
    return ItemRead.model_validate(item)


def register_item_product(
    db: Session, item: Item, payload: RegisterProductRequest
) -> ItemRead:
    job = item.document.job
    _ensure_mutable(db, job)
    if item.matched_product_code:
        raise MatchingOperationError(
            "이미 매칭된 품목입니다. 기존 매칭을 해제한 뒤 직접 등록해 주세요."
        )
    if db.scalar(
        select(ProductIndex.id).where(
            ProductIndex.job_id == job.id,
            ProductIndex.product_code == payload.product_code,
        )
    ) is not None:
        raise MatchingOperationError(
            "같은 상품코드가 이미 상품리스트에 있습니다. 기존 상품을 선택해 주세요."
        )
    if not job.original_excel_path or not job.original_excel_sha256:
        raise MatchingOperationError(
            "상품을 등록하려면 상품리스트 Excel을 먼저 업로드해 주세요."
        )
    source_path = Path(job.original_excel_path)
    if not source_path.is_file() or sha256_file(source_path) != job.original_excel_sha256:
        raise MatchingOperationError(
            "원본 상품리스트 Excel을 확인할 수 없어 상품을 등록하지 못했습니다."
        )
    try:
        source_max_row = product_sheet_max_row(source_path)
    except ExcelValidationError as exc:
        raise MatchingOperationError(str(exc)) from exc

    reserved_max_row = db.scalar(
        select(ProductIndex.excel_row)
        .where(ProductIndex.job_id == job.id)
        .order_by(ProductIndex.excel_row.desc())
        .limit(1)
    )
    product = ProductIndex(
        job_id=job.id,
        product_code=payload.product_code,
        product_name=payload.product_name,
        specification=payload.specification,
        current_stock=payload.current_stock,
        purchase_price=payload.purchase_price,
        supplier_code=payload.supplier_code,
        supplier=payload.supplier,
        excel_row=max(source_max_row, reserved_max_row or 1) + 1,
        is_user_created=True,
    )
    try:
        db.add(product)
        db.flush()
        products = _job_products(db, job.id)
        candidates = rank_product_candidates(
            products,
            product_code_or_barcode=item.product_code_or_barcode,
            product_name=item.product_name,
            specification=item.specification,
            unit_price=item.unit_price,
        )
        item.match_candidates = [
            candidate.model_dump(mode="json") for candidate in candidates
        ]
        _apply_product(item, product, MatchMethod.MANUAL, None)
        _learn_item_match(db, item, product.product_code)
        _auto_approve_item(item, enabled=True)
        validate_item_state(item)
        item.updated_at = utc_now()
        _recalculate_reviews(db, [item])
        db.commit()
    except ItemRuleError as exc:
        db.rollback()
        raise MatchingOperationError(str(exc)) from exc
    db.refresh(item)
    return ItemRead.model_validate(item)


def search_products(
    db: Session, job_id: str, query: str, limit: int
) -> List[ProductCandidate]:
    products = _job_products(db, job_id)
    return rank_product_candidates(
        products,
        product_code_or_barcode=query,
        product_name=query,
        specification=None,
        unit_price=None,
        limit=limit,
    )


def clear_item_match_fields(item: Item) -> None:
    item.matched_product_code = None
    item.matched_product_name = None
    item.matched_specification = None
    item.matched_supplier_code = None
    item.matched_supplier = None
    item.matched_excel_row = None
    item.match_method = None
    item.match_score = None
    item.base_stock = None
    item.base_purchase_price = None
    item.apply_purchase_price = False


def _item_aliases(item: Item) -> list[tuple[str, str]]:
    aliases: list[tuple[str, str]] = []
    for code in (
        item.ocr_product_code_or_barcode,
        item.product_code_or_barcode,
    ):
        normalized = normalize_text(code)
        if normalized:
            aliases.append(("code", normalized))
    for name, specification in (
        (item.ocr_product_name, item.ocr_specification),
        (item.product_name, item.specification),
    ):
        normalized_name = normalize_text(name)
        if normalized_name:
            aliases.append(
                (
                    "name_spec",
                    f"{normalized_name}\x1f{normalize_text(specification)}",
                )
            )
    return list(dict.fromkeys(aliases))


def _remembered_product(
    db: Session, item: Item, products: Sequence[ProductIndex]
) -> Optional[ProductIndex]:
    product_by_code = {product.product_code: product for product in products}
    for alias_type, alias_value in _item_aliases(item):
        learned = db.scalar(
            select(LearnedMatch).where(
                LearnedMatch.alias_type == alias_type,
                LearnedMatch.alias_value == alias_value,
            )
        )
        if learned is not None and learned.product_code in product_by_code:
            return product_by_code[learned.product_code]
    return None


def _learn_item_match(db: Session, item: Item, product_code: str) -> None:
    for alias_type, alias_value in _item_aliases(item):
        learned = db.scalar(
            select(LearnedMatch).where(
                LearnedMatch.alias_type == alias_type,
                LearnedMatch.alias_value == alias_value,
            )
        )
        if learned is None:
            db.add(
                LearnedMatch(
                    alias_type=alias_type,
                    alias_value=alias_value,
                    product_code=product_code,
                )
            )
        else:
            learned.product_code = product_code
            learned.updated_at = utc_now()


def _forget_item_match(db: Session, item: Item, product_code: str) -> None:
    for alias_type, alias_value in _item_aliases(item):
        learned = db.scalar(
            select(LearnedMatch).where(
                LearnedMatch.alias_type == alias_type,
                LearnedMatch.alias_value == alias_value,
                LearnedMatch.product_code == product_code,
            )
        )
        if learned is not None:
            db.delete(learned)


def _apply_product(
    item: Item,
    product: ProductIndex,
    method: MatchMethod,
    score: Optional[float],
    *,
    preserve_purchase_price: bool = False,
) -> None:
    item.matched_product_code = product.product_code
    item.matched_product_name = product.product_name
    item.matched_specification = product.specification
    item.matched_supplier_code = product.supplier_code
    item.matched_supplier = product.supplier
    item.matched_excel_row = product.excel_row
    item.match_method = method
    item.match_score = score
    item.base_stock = _optional_integer(product.current_stock)
    item.base_purchase_price = _optional_integer(product.purchase_price)
    if item.unit_price is None:
        item.apply_purchase_price = False
    elif not preserve_purchase_price:
        item.apply_purchase_price = bool(
            item.unit_price >= 0
            and item.unit_price != item.base_purchase_price
        )


def _auto_approve_item(item: Item, *, enabled: bool) -> None:
    stock_increment = item.stock_increment
    if (
        enabled
        and item.review_status == ReviewStatus.PENDING
        and isinstance(stock_increment, int)
        and not isinstance(stock_increment, bool)
        and stock_increment >= 0
    ):
        item.review_status = ReviewStatus.APPROVED


def _semantic_coverage_score(
    query_name: Optional[str],
    query_specification: Optional[str],
    product_name: Optional[str],
    product_specification: Optional[str],
) -> float:
    query_tokens = _semantic_tokens(
        f"{query_name or ''} {query_specification or ''}"
    )
    product_tokens = _semantic_tokens(
        f"{product_name or ''} {product_specification or ''}"
    )
    if not query_tokens or not product_tokens:
        return 0.0

    covered = []
    for product_token in product_tokens:
        covered.append(
            any(
                product_token == query_token
                or (
                    len(product_token) >= 4
                    and (
                        product_token in query_token
                        or query_token in product_token
                    )
                )
                for query_token in query_tokens
            )
        )
    coverage = sum(covered) / len(covered)
    if coverage < 1:
        return 0.9 * coverage

    dosage_tokens = [token for token in product_tokens if token[0].isdigit()]
    dosage_agrees = not dosage_tokens or all(
        token in query_tokens for token in dosage_tokens
    )
    return 0.94 if dosage_agrees else 0.90


def _semantic_tokens(value: str) -> list[str]:
    normalized = unicodedata.normalize("NFKC", value).casefold()
    return [normalize_text(match.group(0)) for match in _TOKEN_PATTERN.finditer(normalized)]


def _price_similarity(
    photo_price: Optional[int], purchase_price: Optional[int]
) -> Optional[float]:
    if photo_price is None or purchase_price is None:
        return None
    if photo_price < 0 or purchase_price < 0:
        return None
    if photo_price == purchase_price:
        return 1.0
    denominator = max(photo_price, purchase_price, 1)
    return round(max(0.0, 1 - abs(photo_price - purchase_price) / denominator), 6)


def _optional_integer(value: Any) -> Optional[int]:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and math.isfinite(value) and value.is_integer():
        return int(value)
    if isinstance(value, str):
        normalized = value.replace(",", "").strip()
        if re.fullmatch(r"-?\d+", normalized):
            return int(normalized)
    return None


def _job_products(db: Session, job_id: str) -> list[ProductIndex]:
    return list(
        db.scalars(
            select(ProductIndex)
            .where(ProductIndex.job_id == job_id)
            .order_by(ProductIndex.excel_row)
        ).all()
    )


def _ensure_mutable(db: Session, job: Job) -> None:
    if not lock_job_for_mutation(db, job.id):
        raise MatchingOperationError(
            "추출·내보내기 중이거나 완료된 작업은 변경할 수 없습니다."
        )


def _recalculate_reviews(db: Session, items: Iterable[Item]) -> None:
    from app.services.review import recalculate_item_warnings

    for item in items:
        recalculate_item_warnings(item)
    db.flush()
