from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest
from PIL import Image
from pydantic import ValidationError

from app.schemas.extraction import InvoiceExtraction
from app.services.extraction import parse_invoice_image


def extraction_payload(orders=(0,)) -> dict:
    return {
        "document": {
            "photo_supplier": "공급사",
            "transaction_date": "2026-08-06",
            "invoice_number": "A-1",
            "document_total": 1000,
            "raw_header_text": "거래명세서",
            "confidence_by_field": {
                "photo_supplier": 0.9,
                "transaction_date": None,
                "invoice_number": None,
                "document_total": None,
                "raw_header_text": None,
            },
        },
        "items": [
            {
                "source_row_order": order,
                "raw_row_text": f"품목 {order}",
                "product_code_or_barcode": None,
                "product_name": f"상품 {order}",
                "specification": None,
                "quantity": 1,
                "unit_price": 1000,
                "amount": 1000,
                "bundle_or_set_text": None,
                "confidence_by_field": {
                    "raw_row_text": None,
                    "product_code_or_barcode": None,
                    "product_name": 0.8,
                    "specification": None,
                    "quantity": None,
                    "unit_price": None,
                    "amount": None,
                    "bundle_or_set_text": None,
                },
                "extraction_warnings": [],
            }
            for order in orders
        ],
    }


@pytest.mark.parametrize("orders", [(), (0, 0), (1, 0)])
def test_extraction_rejects_empty_duplicate_or_out_of_order_items(orders) -> None:
    with pytest.raises(ValidationError):
        InvoiceExtraction.model_validate(extraction_payload(orders))


def test_responses_parse_retries_once_and_uses_original_detail(tmp_path: Path) -> None:
    image_path = tmp_path / "invoice.png"
    Image.new("RGB", (300, 300), "white").save(image_path)
    parsed = InvoiceExtraction.model_validate(extraction_payload())

    class FakeResponses:
        def __init__(self) -> None:
            self.calls = []

        def parse(self, **kwargs):
            self.calls.append(kwargs)
            if len(self.calls) == 1:
                raise RuntimeError("temporary")
            return SimpleNamespace(output=[], output_parsed=parsed)

    responses = FakeResponses()
    client = SimpleNamespace(responses=responses)

    result = parse_invoice_image(image_path, "secret", "gpt-test", client=client)

    assert result == parsed
    assert len(responses.calls) == 2
    image_part = responses.calls[1]["input"][0]["content"][1]
    assert image_part["detail"] == "original"
    assert image_part["image_url"].startswith("data:image/png;base64,")
    assert responses.calls[1]["text_format"] is InvoiceExtraction


def test_structured_output_schema_forbids_extra_object_properties() -> None:
    schema = InvoiceExtraction.model_json_schema()

    def assert_strict_objects(value) -> None:
        if isinstance(value, dict):
            if value.get("type") == "object":
                assert value.get("additionalProperties") is False
                assert set(value.get("required", [])) == set(value.get("properties", {}))
            for nested in value.values():
                assert_strict_objects(nested)
        elif isinstance(value, list):
            for nested in value:
                assert_strict_objects(nested)

    assert_strict_objects(schema)


def test_responses_parse_does_not_accept_refusal(tmp_path: Path) -> None:
    image_path = tmp_path / "invoice.png"
    Image.new("RGB", (300, 300), "white").save(image_path)
    refusal = SimpleNamespace(type="refusal", refusal="cannot")
    response = SimpleNamespace(
        output=[SimpleNamespace(content=[refusal])], output_parsed=None
    )
    responses = SimpleNamespace(parse=lambda **_: response)

    with pytest.raises(RuntimeError, match="구조화 추출에 실패"):
        parse_invoice_image(
            image_path,
            "secret",
            "gpt-test",
            client=SimpleNamespace(responses=responses),
        )
