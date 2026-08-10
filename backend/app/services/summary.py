from __future__ import annotations

from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import (
    Document,
    DocumentStatus,
    DuplicateStatus,
    Item,
    Job,
    PriceResolution,
    ProductIndex,
    ResolutionMethod,
    ReviewStatus,
)
from app.models.job import utc_now
from app.schemas.exports import (
    PriceCandidateRead,
    ProductReviewRead,
    ReviewBlocker,
    ReviewCounts,
    ReviewSummaryRead,
)
from app.services.duplicates import recalculate_job_duplicates
from app.services.excel import (
    ExcelValidationError,
    ProductRecord,
    sha256_file,
    validate_product_workbook,
)
from app.services.inventory import sum_inventory_increment
from app.services.job_mutations import lock_job_for_mutation
from app.services.pricing import PriceCandidateInput, resolve_price


class SummaryOperationError(ValueError):
    pass


def build_review_summary(db: Session, job: Job) -> ReviewSummaryRead:
    documents = list(
        db.scalars(
            select(Document)
            .options(selectinload(Document.items))
            .where(Document.job_id == job.id)
            .order_by(Document.source_order)
        ).all()
    )
    recalculate_job_duplicates(db, job.id, flush=False)
    items = [
        item
        for document in documents
        for item in sorted(document.items, key=lambda row: row.source_row_order)
    ]
    products = list(
        db.scalars(
            select(ProductIndex)
            .where(ProductIndex.job_id == job.id)
            .order_by(ProductIndex.excel_row)
        ).all()
    )
    resolutions = {
        row.product_code: row
        for row in db.scalars(
            select(PriceResolution).where(PriceResolution.job_id == job.id)
        ).all()
    }

    blockers: list[ReviewBlocker] = []
    workbook_records = _validate_original_excel(job, blockers)
    _append_document_blockers(documents, blockers)
    _append_item_blockers(items, blockers)

    product_by_code = {product.product_code: product for product in products}
    workbook_by_code = {
        record.product_code: record for record in workbook_records
    }
    grouped: dict[str, list[Item]] = defaultdict(list)
    for item in items:
        if item.matched_product_code:
            grouped[item.matched_product_code].append(item)

    invalid_basis_ids = [
        item.id
        for code, rows in grouped.items()
        for item in rows
        if item.review_status != ReviewStatus.EXCLUDED
        and not _has_valid_product_basis(
            item,
            product_by_code.get(code),
            workbook_by_code.get(code),
        )
    ]
    if invalid_basis_ids:
        blockers.append(
            ReviewBlocker(
                code="INVALID_PRODUCT_BASIS",
                message=(
                    "상품코드, Excel 행 또는 기준 현재고가 원본 상품리스트나 "
                    "사용자 등록값과 일치하지 않습니다. 상품 정보를 다시 확인해 주세요."
                ),
                item_ids=invalid_basis_ids,
            )
        )

    summaries: list[ProductReviewRead] = []
    for product_code, rows in sorted(
        grouped.items(),
        key=lambda pair: (
            product_by_code[pair[0]].excel_row
            if pair[0] in product_by_code
            else 2**31,
            pair[0],
        ),
    ):
        product = product_by_code.get(product_code)
        workbook_product = workbook_by_code.get(product_code)
        canonical = workbook_product or product
        base_stock = _optional_integer(
            canonical.current_stock if canonical is not None else None
        )
        base_purchase_price = _optional_nonnegative_integer(
            canonical.purchase_price if canonical is not None else None
        )
        increment = sum_inventory_increment(rows)
        final_stock = base_stock + increment if base_stock is not None else None

        eligible = [
            item
            for item in rows
            if item.review_status == ReviewStatus.APPROVED
            and item.apply_purchase_price
            and _is_nonnegative_integer(item.unit_price)
        ]
        candidate_inputs = [
            PriceCandidateInput(
                item_id=item.id,
                transaction_date=item.document.transaction_date,
                unit_price=item.unit_price,
            )
            for item in eligible
        ]
        stored = resolutions.get(product_code)
        manual_item_id = (
            stored.selected_item_id
            if stored is not None
            and stored.resolution_method == ResolutionMethod.MANUAL
            else None
        )
        decision = resolve_price(candidate_inputs, manual_item_id)

        if decision.method == ResolutionMethod.UNRESOLVED:
            blockers.append(
                ReviewBlocker(
                    code="UNRESOLVED_PRICE",
                    message=(
                        f"상품코드 {product_code}의 매입단가 충돌을 해결해 주세요."
                    ),
                    item_ids=[item.id for item in eligible],
                    document_ids=_unique(
                        item.document_id for item in eligible
                    ),
                )
            )

        selected_item_id = decision.selected_item_id
        price_candidates = [
            PriceCandidateRead(
                item_id=item.id,
                document_id=item.document_id,
                document_name=item.document.original_image_name,
                transaction_date=item.document.transaction_date,
                unit_price=item.unit_price,
                quantity=item.quantity,
                selected=item.id == selected_item_id,
            )
            for item in eligible
        ]
        final_purchase_price = (
            base_purchase_price
            if decision.method is None
            else decision.selected_unit_price
        )
        summaries.append(
            ProductReviewRead(
                product_code=product_code,
                product_name=(
                    canonical.product_name if canonical is not None else None
                ),
                base_stock=base_stock,
                stock_increment=increment,
                final_stock=final_stock,
                base_purchase_price=base_purchase_price,
                final_purchase_price=final_purchase_price,
                item_ids=[item.id for item in rows],
                price_resolution_method=(
                    decision.method.value if decision.method is not None else None
                ),
                price_candidates=price_candidates,
            )
        )

    counts = ReviewCounts(
        approved_items=sum(
            item.review_status == ReviewStatus.APPROVED for item in items
        ),
        excluded_items=sum(
            item.review_status == ReviewStatus.EXCLUDED for item in items
        ),
        pending_items=sum(
            item.review_status == ReviewStatus.PENDING for item in items
        ),
        inventory_products=sum(
            product.base_stock is not None
            and product.final_stock is not None
            and product.final_stock != product.base_stock
            for product in summaries
        ),
        price_products=sum(
            product.final_purchase_price is not None
            and product.final_purchase_price != product.base_purchase_price
            for product in summaries
        ),
    )
    return ReviewSummaryRead(
        job_id=job.id,
        ready_to_export=not blockers,
        blockers=blockers,
        counts=counts,
        products=summaries,
    )


def set_manual_price_resolution(
    db: Session, job: Job, product_code: str, selected_item_id: str
) -> ReviewSummaryRead:
    if not lock_job_for_mutation(db, job.id):
        raise SummaryOperationError(
            "추출·내보내기 중이거나 완료된 작업은 변경할 수 없습니다."
        )

    summary = build_review_summary(db, job)
    product = next(
        (row for row in summary.products if row.product_code == product_code),
        None,
    )
    if product is None:
        raise SummaryOperationError("현재 작업에서 선택한 상품을 찾을 수 없습니다.")
    candidate = next(
        (
            row
            for row in product.price_candidates
            if row.item_id == selected_item_id
        ),
        None,
    )
    if candidate is None:
        raise SummaryOperationError(
            "승인되고 매입단가 반영이 선택된 유효한 품목만 대표 단가로 선택할 수 있습니다."
        )

    decision = resolve_price(
        [
            PriceCandidateInput(
                item_id=row.item_id,
                transaction_date=row.transaction_date,
                unit_price=row.unit_price,
            )
            for row in product.price_candidates
        ],
        selected_item_id,
    )
    if (
        product.price_resolution_method == ResolutionMethod.UNRESOLVED.value
        and decision.method != ResolutionMethod.MANUAL
    ):
        raise SummaryOperationError(
            "최신 거래일자에 해당하는 단가 후보를 선택해 주세요."
        )

    resolution = db.scalar(
        select(PriceResolution).where(
            PriceResolution.job_id == job.id,
            PriceResolution.product_code == product_code,
        )
    )
    if resolution is None:
        resolution = PriceResolution(job_id=job.id, product_code=product_code)
        db.add(resolution)
    resolution.resolution_method = ResolutionMethod.MANUAL
    resolution.selected_item_id = selected_item_id
    resolution.selected_unit_price = candidate.unit_price
    resolution.updated_at = utc_now()
    db.flush()
    updated = build_review_summary(db, job)
    db.commit()
    return updated


def _validate_original_excel(
    job: Job, blockers: list[ReviewBlocker]
) -> list[ProductRecord]:
    if not job.original_excel_path or not job.original_excel_sha256:
        blockers.append(
            ReviewBlocker(
                code="ORIGINAL_EXCEL_MISSING",
                message="원본 상품리스트 Excel을 업로드해 주세요.",
            )
        )
        return []
    path = Path(job.original_excel_path)
    try:
        if not path.is_file():
            raise OSError
        if sha256_file(path) != job.original_excel_sha256:
            blockers.append(
                ReviewBlocker(
                    code="ORIGINAL_EXCEL_CHANGED",
                    message="원본 Excel 해시가 업로드 당시와 다릅니다.",
                )
            )
            return []
        return validate_product_workbook(path)
    except (OSError, ExcelValidationError):
        blockers.append(
            ReviewBlocker(
                code="ORIGINAL_EXCEL_INVALID",
                message="원본 상품리스트 Excel을 읽거나 검증할 수 없습니다.",
            )
        )
        return []


def _append_document_blockers(
    documents: list[Document], blockers: list[ReviewBlocker]
) -> None:
    if not documents:
        blockers.append(
            ReviewBlocker(
                code="NO_DOCUMENTS",
                message="완료된 거래명세서가 하나 이상 필요합니다.",
            )
        )
        return
    incomplete = [
        document.id
        for document in documents
        if document.status != DocumentStatus.COMPLETED
    ]
    if incomplete:
        blockers.append(
            ReviewBlocker(
                code="DOCUMENT_NOT_COMPLETED",
                message="처리가 완료되지 않았거나 실패한 거래명세서가 있습니다.",
                document_ids=incomplete,
            )
        )
    duplicates = [
        document.id
        for document in documents
        if document.duplicate_status == DuplicateStatus.CONFIRMED
    ]
    if duplicates:
        blockers.append(
            ReviewBlocker(
                code="CONFIRMED_DUPLICATE",
                message="확정 중복 거래명세서를 제거해 주세요.",
                document_ids=duplicates,
            )
        )


def _append_item_blockers(
    items: list[Item], blockers: list[ReviewBlocker]
) -> None:
    if not items:
        blockers.append(
            ReviewBlocker(
                code="NO_REVIEW_ITEMS",
                message="검수할 품목이 하나 이상 필요합니다.",
            )
        )
        return
    pending = [
        item.id for item in items if item.review_status == ReviewStatus.PENDING
    ]
    if pending:
        blockers.append(
            ReviewBlocker(
                code="PENDING_ITEMS",
                message="보류 상태의 품목을 승인하거나 제외해 주세요.",
                item_ids=pending,
            )
        )
    unmatched = [
        item.id
        for item in items
        if item.review_status != ReviewStatus.EXCLUDED
        and not item.matched_product_code
    ]
    if unmatched:
        blockers.append(
            ReviewBlocker(
                code="UNMATCHED_ITEMS",
                message="미매칭 품목을 상품에 연결하거나 제외해 주세요.",
                item_ids=unmatched,
            )
        )
    invalid_stock = [
        item.id
        for item in items
        if item.review_status == ReviewStatus.APPROVED
        and (
            not item.matched_product_code
            or not _is_nonnegative_integer(item.stock_increment)
        )
    ]
    if invalid_stock:
        blockers.append(
            ReviewBlocker(
                code="INVALID_APPROVED_STOCK",
                message="승인 품목의 상품 매칭과 0 이상의 입고 수량을 확인해 주세요.",
                item_ids=invalid_stock,
            )
        )


def _has_valid_product_basis(
    item: Item,
    product: Optional[ProductIndex],
    workbook_product: Optional[ProductRecord],
) -> bool:
    if product is None:
        return False
    if product.is_user_created:
        indexed_stock = _optional_integer(product.current_stock)
        return bool(
            item.matched_product_code == product.product_code
            and item.matched_excel_row == product.excel_row
            and indexed_stock is not None
            and item.base_stock == indexed_stock
        )
    if workbook_product is None:
        return False
    canonical_stock = _optional_integer(workbook_product.current_stock)
    indexed_stock = _optional_integer(product.current_stock)
    return bool(
        item.matched_product_code == product.product_code
        and product.product_code == workbook_product.product_code
        and item.matched_excel_row == product.excel_row
        and product.excel_row == workbook_product.excel_row
        and canonical_stock is not None
        and indexed_stock == canonical_stock
        and item.base_stock == canonical_stock
    )


def _optional_integer(value: Any) -> Optional[int]:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str):
        normalized = value.replace(",", "").strip()
        if normalized.lstrip("-").isdigit():
            return int(normalized)
    return None


def _optional_nonnegative_integer(value: Any) -> Optional[int]:
    parsed = _optional_integer(value)
    return parsed if parsed is not None and parsed >= 0 else None


def _is_nonnegative_integer(value: Any) -> bool:
    return (
        isinstance(value, int)
        and not isinstance(value, bool)
        and value >= 0
    )


def _unique(values: Iterable[str]) -> list[str]:
    return list(dict.fromkeys(values))
