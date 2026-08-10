from __future__ import annotations

import re
from typing import Any, Dict, List

from app.models import Document, Item
from app.services.matching import normalize_text


LOW_CONFIDENCE_THRESHOLD = 0.8
PRICE_DIFFERENCE_THRESHOLD = 0.30


def recalculate_document_warnings(document: Document) -> None:
    for item in document.items:
        recalculate_item_warnings(item)


def recalculate_item_warnings(item: Item) -> None:
    document = item.document
    warnings: List[Dict[str, Any]] = []

    if (
        item.quantity is not None
        and item.unit_price is not None
        and item.amount is not None
    ):
        expected = item.quantity * item.unit_price
        if expected != item.amount:
            warnings.append(
                _warning(
                    "amount_mismatch",
                    "수량과 단가의 곱이 품목 금액과 다릅니다.",
                    quantity=item.quantity,
                    unit_price=item.unit_price,
                    expected_amount=expected,
                    actual_amount=item.amount,
                )
            )

    if not item.is_manual and (
        item.confidence is None or item.confidence < LOW_CONFIDENCE_THRESHOLD
    ):
        warnings.append(
            _warning(
                "low_confidence",
                "OCR 신뢰도가 낮아 원본 이미지 확인이 필요합니다.",
                confidence=item.confidence,
                threshold=LOW_CONFIDENCE_THRESHOLD,
            )
        )

    if item.unit_price is not None and item.matched_product_code:
        if item.base_purchase_price is None:
            warnings.append(
                _warning(
                    "missing_base_purchase_price",
                    "상품리스트의 기존 매입단가가 없어 사진 단가를 확인해야 합니다.",
                    photo_unit_price=item.unit_price,
                )
            )
        elif _price_difference_ratio(item.unit_price, item.base_purchase_price) >= (
            PRICE_DIFFERENCE_THRESHOLD
        ):
            warnings.append(
                _warning(
                    "purchase_price_difference",
                    "사진 단가와 기존 매입단가의 차이가 30% 이상입니다.",
                    photo_unit_price=item.unit_price,
                    base_purchase_price=item.base_purchase_price,
                    difference_ratio=_price_difference_ratio(
                        item.unit_price, item.base_purchase_price
                    ),
                    threshold=PRICE_DIFFERENCE_THRESHOLD,
                )
            )

    if (
        document.photo_supplier
        and item.matched_supplier
        and normalize_text(document.photo_supplier)
        != normalize_text(item.matched_supplier)
    ):
        warnings.append(
            _warning(
                "supplier_mismatch",
                "사진 공급자와 상품리스트의 공급사가 다릅니다.",
                photo_supplier=document.photo_supplier,
                matched_supplier=item.matched_supplier,
            )
        )

    bundle_evidence = item.bundle_or_set_text or item.product_name or ""
    if item.bundle_or_set_text or re.search(
        r"묶음|세트|\d+\s*\+\s*\d+", bundle_evidence, re.IGNORECASE
    ):
        warnings.append(
            _warning(
                "bundle_or_set",
                "묶음 또는 세트 상품일 수 있어 실제 입고 수량 확인이 필요합니다.",
                detected_text=bundle_evidence,
                stock_increment=item.stock_increment,
            )
        )

    if document.correction_warning:
        warnings.append(
            _warning(
                "image_correction_warning",
                "이미지 보정 결과를 원본과 비교해 주세요.",
                correction_warning=document.correction_warning,
            )
        )

    missing_fields = [
        field
        for field, value in (
            ("photo_supplier", document.photo_supplier),
            ("transaction_date", document.transaction_date),
            ("invoice_number", document.invoice_number),
            ("document_total", document.document_total),
        )
        if value is None or (isinstance(value, str) and not value.strip())
    ]
    if missing_fields:
        warnings.append(
            _warning(
                "missing_document_info",
                "명세서 식별 또는 금액 확인에 필요한 문서 정보가 누락되었습니다.",
                missing_fields=missing_fields,
            )
        )

    item_amounts = [row.amount for row in document.items]
    if (
        document.document_total is not None
        and item_amounts
        and all(amount is not None for amount in item_amounts)
    ):
        item_total = sum(amount for amount in item_amounts if amount is not None)
        if item_total != document.document_total:
            warnings.append(
                _warning(
                    "document_total_mismatch",
                    "품목 금액 합계가 명세서 합계와 다릅니다.",
                    item_total=item_total,
                    document_total=document.document_total,
                )
            )

    item.warnings = warnings


def _price_difference_ratio(photo_price: int, base_price: int) -> float:
    if base_price == 0:
        return 0.0 if photo_price == 0 else 1.0
    return round(abs(photo_price - base_price) / abs(base_price), 6)


def _warning(code: str, message: str, **evidence: Any) -> Dict[str, Any]:
    return {"code": code, "message": message, "evidence": evidence}
