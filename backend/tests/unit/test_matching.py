from pathlib import Path
from typing import Optional

from app.core.database import Base, build_engine, build_session_factory
from app.models import Document, Item, Job, MatchMethod, ProductIndex, ReviewStatus
from app.services.matching import (
    manually_match_item,
    rank_product_candidates,
    recalculate_item_match,
    should_auto_match,
)


def product(
    code: str,
    name: str,
    row: int,
    *,
    specification: Optional[str] = None,
    purchase_price=1000,
    supplier: str = "공급사",
) -> ProductIndex:
    return ProductIndex(
        job_id="job",
        product_code=code,
        product_name=name,
        specification=specification,
        current_stock=0,
        purchase_price=purchase_price,
        supplier=supplier,
        excel_row=row,
    )


def test_auto_match_requires_exactly_one_candidate_at_or_above_90() -> None:
    assert should_auto_match([0.90, 0.899999]) is True
    assert should_auto_match([1.0]) is True
    assert should_auto_match([0.899999, 0.80]) is False
    assert should_auto_match([0.95, 0.90]) is False


def test_candidate_ranking_is_limited_and_price_is_only_auxiliary() -> None:
    products = [
        product("A", "정확한 상품", 2, purchase_price=9999),
        product("B", "전혀 다른 상품", 3, purchase_price=1000),
        product("C", "유사 상품 하나", 4),
        product("D", "유사 상품 둘", 5),
        product("E", "유사 상품 셋", 6),
        product("F", "유사 상품 넷", 7),
    ]

    candidates = rank_product_candidates(
        products,
        product_code_or_barcode=None,
        product_name="정확한 상품",
        specification=None,
        unit_price=1000,
    )

    assert len(candidates) == 5
    assert candidates[0].product_code == "A"
    assert candidates[0].score == 1.0
    assert candidates[0].price_similarity < candidates[1].price_similarity


def test_mounjaro_partial_name_and_dose_are_ranked_for_manual_review() -> None:
    products = [
        product("P1", "타이레놀정 500mg", 100),
        product("P2", "비타민 주사 5mg", 101),
        product("P3", "마운자로 5mg", 1556, purchase_price=369307, supplier="백제약품"),
        product("P4", "마운자로 2.5mg", 1555, purchase_price=300000),
        product("P5", "소화제", 200),
        product("P6", "감기약", 201),
    ]

    candidates = rank_product_candidates(
        products,
        product_code_or_barcode=None,
        product_name="마운자로프리필드펜주 5mg/0.5mL(4PEN)",
        specification=None,
        unit_price=369307,
    )

    selected = next(row for row in candidates if row.excel_row == 1556)
    assert candidates[0] == selected
    assert selected.score == 0.94
    assert selected.purchase_price == 369307
    assert selected.supplier == "백제약품"


def test_invalid_json_numeric_value_is_exposed_as_none() -> None:
    candidate = rank_product_candidates(
        [product("A", "상품", 2, purchase_price=99.5)],
        product_code_or_barcode="A",
        product_name=None,
        specification=None,
        unit_price=100,
    )[0]

    assert candidate.purchase_price is None
    assert candidate.price_similarity is None


def test_duplicate_normalized_product_name_is_not_auto_matched(tmp_path: Path) -> None:
    engine = build_engine(f"sqlite:///{tmp_path / 'duplicate-name.db'}")
    Base.metadata.create_all(engine)
    session_factory = build_session_factory(engine)
    with session_factory() as session:
        job = Job()
        document = Document(
            job=job,
            source_order=0,
            original_image_path="image.png",
            original_image_name="image.png",
            image_sha256="a" * 64,
        )
        item = Item(source_row_order=0, product_name="동일 상품", quantity=1)
        document.items.append(item)
        job.products.extend(
            [
                ProductIndex(
                    product_code="A",
                    product_name="동일 상품",
                    specification="1정",
                    excel_row=2,
                ),
                ProductIndex(
                    product_code="B",
                    product_name="동일상품",
                    specification="2정",
                    excel_row=3,
                ),
            ]
        )
        session.add(job)
        session.flush()

        recalculate_item_match(session, item, job.products)

        assert item.matched_product_code is None
        assert item.review_status == ReviewStatus.PENDING
        assert len(item.match_candidates) == 2
    engine.dispose()


def test_unique_exact_code_is_auto_matched_even_with_duplicate_name(tmp_path: Path) -> None:
    engine = build_engine(f"sqlite:///{tmp_path / 'exact-code.db'}")
    Base.metadata.create_all(engine)
    session_factory = build_session_factory(engine)
    with session_factory() as session:
        job = Job()
        document = Document(
            job=job,
            source_order=0,
            original_image_path="image.png",
            original_image_name="image.png",
            image_sha256="b" * 64,
        )
        item = Item(
            source_row_order=0,
            product_code_or_barcode="B",
            product_name="동일 상품",
            quantity=1,
        )
        document.items.append(item)
        job.products.extend(
            [
                ProductIndex(product_code="A", product_name="동일 상품", excel_row=2),
                ProductIndex(product_code="B", product_name="동일상품", excel_row=3),
            ]
        )
        session.add(job)
        session.flush()

        recalculate_item_match(session, item, job.products)

        assert item.matched_product_code == "B"
        assert item.match_method == MatchMethod.CODE
    engine.dispose()


def test_unique_90_point_candidate_is_auto_approved_only_when_requested(
    tmp_path: Path,
) -> None:
    engine = build_engine(f"sqlite:///{tmp_path / 'auto-approve.db'}")
    Base.metadata.create_all(engine)
    session_factory = build_session_factory(engine)
    with session_factory() as session:
        job = Job()
        document = Document(
            job=job,
            source_order=0,
            original_image_path="image.png",
            original_image_name="image.png",
            image_sha256="c" * 64,
        )
        automatic = Item(
            source_row_order=0,
            product_name="자동 승인 상품",
            quantity=1,
            stock_increment=1,
        )
        manual_review = Item(
            source_row_order=1,
            product_name="자동 승인 상품",
            quantity=1,
            stock_increment=1,
        )
        document.items.extend([automatic, manual_review])
        job.products.extend(
            [
                ProductIndex(
                    product_code="A",
                    product_name="자동 승인 상품",
                    excel_row=2,
                ),
                ProductIndex(
                    product_code="B",
                    product_name="전혀 다른 품목",
                    excel_row=3,
                ),
            ]
        )
        session.add(job)
        session.flush()

        recalculate_item_match(
            session, automatic, job.products, auto_approve=True
        )
        recalculate_item_match(session, manual_review, job.products)

        assert automatic.match_score == 1.0
        assert automatic.review_status == ReviewStatus.APPROVED
        assert manual_review.review_status == ReviewStatus.PENDING
    engine.dispose()


def test_manual_match_is_remembered_and_auto_applied_in_next_job(
    tmp_path: Path,
) -> None:
    engine = build_engine(f"sqlite:///{tmp_path / 'learned-match.db'}")
    Base.metadata.create_all(engine)
    session_factory = build_session_factory(engine)
    with session_factory() as session:
        first_job = Job()
        first_document = Document(
            job=first_job,
            source_order=0,
            original_image_path="first.png",
            original_image_name="first.png",
            image_sha256="d" * 64,
        )
        first_item = Item(
            source_row_order=0,
            ocr_product_name="반복 OCR 별칭",
            ocr_specification="10정",
            product_name="반복 OCR 별칭",
            specification="10정",
            quantity=2,
            stock_increment=2,
        )
        first_document.items.append(first_item)
        first_job.products.append(
            ProductIndex(
                product_code="REAL-1",
                product_name="실제 상품명",
                specification="10정",
                current_stock=3,
                purchase_price=1000,
                excel_row=2,
            )
        )
        session.add(first_job)
        session.flush()

        manually_match_item(session, first_item, "REAL-1", approve=True)

        second_job = Job()
        second_document = Document(
            job=second_job,
            source_order=0,
            original_image_path="second.png",
            original_image_name="second.png",
            image_sha256="e" * 64,
        )
        second_item = Item(
            source_row_order=0,
            ocr_product_name="반복 OCR 별칭",
            ocr_specification="10정",
            product_name="반복 OCR 별칭",
            specification="10정",
            quantity=1,
            stock_increment=1,
        )
        second_document.items.append(second_item)
        second_job.products.append(
            ProductIndex(
                product_code="REAL-1",
                product_name="실제 상품명",
                specification="10정",
                current_stock=5,
                purchase_price=1000,
                excel_row=2,
            )
        )
        session.add(second_job)
        session.flush()

        recalculate_item_match(
            session, second_item, second_job.products, auto_approve=True
        )

        assert second_item.matched_product_code == "REAL-1"
        assert second_item.match_method == MatchMethod.MANUAL
        assert second_item.review_status == ReviewStatus.APPROVED
        assert second_item.base_stock == 5
    engine.dispose()
