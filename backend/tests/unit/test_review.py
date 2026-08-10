from datetime import date

import pytest
from pydantic import ValidationError

from app.models import Document, Item
from app.schemas.documents import StructuredWarning
from app.services.review import recalculate_item_warnings


def warning_codes(item: Item) -> set[str]:
    return {warning["code"] for warning in item.warnings}


def test_structured_amount_supplier_price_and_bundle_warnings() -> None:
    document = Document(
        source_order=0,
        original_image_path="image.png",
        original_image_name="image.png",
        image_sha256="a" * 64,
        photo_supplier="사진 공급사",
        transaction_date=date(2026, 8, 7),
        invoice_number="INV-1",
        document_total=2500,
        correction_warning="문서 영역을 찾지 못했습니다.",
    )
    item = Item(
        source_row_order=0,
        is_manual=False,
        product_name="묶음10+1 상품",
        quantity=2,
        unit_price=1000,
        amount=2500,
        stock_increment=2,
        confidence=0.79,
        matched_product_code="P1",
        matched_supplier="Excel 공급사",
        base_purchase_price=700,
    )
    document.items.append(item)

    recalculate_item_warnings(item)

    assert warning_codes(item) == {
        "amount_mismatch",
        "low_confidence",
        "purchase_price_difference",
        "supplier_mismatch",
        "bundle_or_set",
        "image_correction_warning",
    }
    for warning in item.warnings:
        assert set(warning) == {"code", "message", "evidence"}
        assert warning["message"]
        assert isinstance(warning["evidence"], dict)


def test_price_difference_warning_starts_at_thirty_percent() -> None:
    document = Document(
        source_order=0,
        original_image_path="image.png",
        original_image_name="image.png",
        image_sha256="b" * 64,
        photo_supplier="공급사",
        transaction_date=date(2026, 8, 7),
        invoice_number="INV-2",
        document_total=130,
    )
    item = Item(
        source_row_order=0,
        is_manual=True,
        quantity=1,
        unit_price=130,
        amount=130,
        matched_product_code="P1",
        matched_supplier="공급사",
        base_purchase_price=100,
    )
    document.items.append(item)

    recalculate_item_warnings(item)
    warning = next(
        warning
        for warning in item.warnings
        if warning["code"] == "purchase_price_difference"
    )

    assert warning["evidence"]["difference_ratio"] == 0.3


def test_missing_invalid_base_price_and_document_info_are_warned() -> None:
    document = Document(
        source_order=0,
        original_image_path="image.png",
        original_image_name="image.png",
        image_sha256="c" * 64,
    )
    item = Item(
        source_row_order=0,
        is_manual=True,
        quantity=1,
        unit_price=100,
        amount=100,
        matched_product_code="P1",
        base_purchase_price=None,
    )
    document.items.append(item)

    recalculate_item_warnings(item)

    assert "missing_base_purchase_price" in warning_codes(item)
    missing = next(
        warning
        for warning in item.warnings
        if warning["code"] == "missing_document_info"
    )
    assert set(missing["evidence"]["missing_fields"]) == {
        "photo_supplier",
        "transaction_date",
        "invoice_number",
        "document_total",
    }


def test_structured_warning_schema_rejects_incomplete_warning() -> None:
    with pytest.raises(ValidationError):
        StructuredWarning.model_validate(
            {"code": "amount_mismatch", "message": "근거 필드가 없습니다."}
        )
