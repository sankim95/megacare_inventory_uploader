from __future__ import annotations

import hashlib
import json
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import CompletedDocument, Document, DuplicateStatus
from app.services.matching import normalize_text


def recalculate_job_duplicates(
    db: Session, job_id: str, *, flush: bool = True
) -> None:
    documents = list(
        db.scalars(
            select(Document)
            .options(selectinload(Document.items))
            .where(Document.job_id == job_id)
            .order_by(Document.source_order)
        ).all()
    )
    for document in documents:
        document.document_identity_key = build_document_identity_key(document)
        document.item_signature = build_item_signature(document)
        document.duplicate_status = DuplicateStatus.NONE

    completed = list(db.scalars(select(CompletedDocument)).all())
    for document in documents:
        if any(_is_confirmed_against_completed(document, row) for row in completed):
            document.duplicate_status = DuplicateStatus.CONFIRMED

    for index, left in enumerate(documents):
        for right in documents[index + 1 :]:
            if _is_confirmed_pair(left, right):
                right.duplicate_status = DuplicateStatus.CONFIRMED
            elif (
                right.duplicate_status != DuplicateStatus.CONFIRMED
                and _is_suspected_pair(left, right)
            ):
                right.duplicate_status = DuplicateStatus.SUSPECTED
    if flush:
        db.flush()


def has_completed_image_hash(db: Session, image_sha256: str) -> bool:
    return (
        db.scalar(
            select(CompletedDocument.id)
            .where(CompletedDocument.image_sha256 == image_sha256)
            .limit(1)
        )
        is not None
    )


def current_documents_with_image_hash(
    db: Session, job_id: str, image_sha256: str
) -> list[Document]:
    return list(
        db.scalars(
            select(Document).where(
                Document.job_id == job_id,
                Document.image_sha256 == image_sha256,
            )
        ).all()
    )


def build_document_identity_key(document: Document) -> Optional[str]:
    supplier = normalize_text(document.photo_supplier)
    invoice_number = normalize_text(document.invoice_number)
    if not supplier or document.transaction_date is None or not invoice_number:
        return None
    return _digest(
        {
            "supplier": supplier,
            "transaction_date": document.transaction_date.isoformat(),
            "invoice_number": invoice_number,
        }
    )


def build_item_signature(document: Document) -> Optional[str]:
    if normalize_text(document.invoice_number):
        return None
    supplier = normalize_text(document.photo_supplier)
    if (
        not supplier
        or document.transaction_date is None
        or document.document_total is None
        or not document.items
    ):
        return None

    item_rows: list[tuple[Any, ...]] = []
    for item in document.items:
        identity = normalize_text(
            item.product_code_or_barcode or item.product_name
        )
        if (
            not identity
            or item.quantity is None
            or item.unit_price is None
            or item.amount is None
        ):
            return None
        item_rows.append(
            (identity, item.quantity, item.unit_price, item.amount)
        )
    item_rows.sort()
    return _digest(
        {
            "supplier": supplier,
            "transaction_date": document.transaction_date.isoformat(),
            "document_total": document.document_total,
            "items": item_rows,
        }
    )


def _is_confirmed_against_completed(
    document: Document, completed: CompletedDocument
) -> bool:
    return bool(
        document.image_sha256 == completed.image_sha256
        or (
            document.document_identity_key
            and document.document_identity_key
            == completed.document_identity_key
        )
        or (
            document.item_signature
            and document.item_signature == completed.item_signature
        )
    )


def _is_confirmed_pair(left: Document, right: Document) -> bool:
    return bool(
        left.image_sha256 == right.image_sha256
        or (
            left.document_identity_key
            and left.document_identity_key == right.document_identity_key
        )
        or (
            left.item_signature
            and left.item_signature == right.item_signature
        )
    )


def _is_suspected_pair(left: Document, right: Document) -> bool:
    left_supplier = normalize_text(left.photo_supplier)
    return bool(
        left_supplier
        and left_supplier == normalize_text(right.photo_supplier)
        and left.transaction_date is not None
        and left.transaction_date == right.transaction_date
    )


def _digest(value: Any) -> str:
    serialized = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()
