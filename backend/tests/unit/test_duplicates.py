from datetime import date
from pathlib import Path
from typing import Optional

from app.core.database import Base, build_engine, build_session_factory
from app.models import CompletedDocument, Document, DuplicateStatus, Item, Job
from app.services.duplicates import (
    build_item_signature,
    recalculate_job_duplicates,
)


def document(
    image_hash: str,
    invoice_number: Optional[str],
    *,
    supplier: str = "공급사",
    document_total: int = 1000,
) -> Document:
    row = Document(
        source_order=0,
        original_image_path="image.png",
        original_image_name="image.png",
        image_sha256=image_hash,
        photo_supplier=supplier,
        transaction_date=date(2026, 8, 7),
        invoice_number=invoice_number,
        document_total=document_total,
    )
    row.items.append(
        Item(
            source_row_order=0,
            product_name="상품",
            quantity=1,
            unit_price=1000,
            amount=1000,
        )
    )
    return row


def test_fallback_signature_is_order_independent() -> None:
    left = document("a" * 64, None, document_total=3000)
    left.items.append(
        Item(
            source_row_order=1,
            product_code_or_barcode="P2",
            quantity=1,
            unit_price=2000,
            amount=2000,
        )
    )
    right = document("b" * 64, None, document_total=3000)
    right.items.insert(
        0,
        Item(
            source_row_order=1,
            product_code_or_barcode="P2",
            quantity=1,
            unit_price=2000,
            amount=2000,
        ),
    )

    assert build_item_signature(left) == build_item_signature(right)


def test_current_job_marks_only_later_confirmed_or_suspected(tmp_path: Path) -> None:
    engine = build_engine(f"sqlite:///{tmp_path / 'current-duplicates.db'}")
    Base.metadata.create_all(engine)
    session_factory = build_session_factory(engine)
    with session_factory() as session:
        job = Job()
        first = document("a" * 64, "INV-1")
        second = document("b" * 64, "INV-1")
        third = document("c" * 64, "INV-2")
        for order, row in enumerate((first, second, third)):
            row.source_order = order
            job.documents.append(row)
        session.add(job)
        session.flush()

        recalculate_job_duplicates(session, job.id)

        assert first.duplicate_status == DuplicateStatus.NONE
        assert second.duplicate_status == DuplicateStatus.CONFIRMED
        assert third.duplicate_status == DuplicateStatus.SUSPECTED
    engine.dispose()


def test_completed_history_marks_reupload_confirmed(tmp_path: Path) -> None:
    engine = build_engine(f"sqlite:///{tmp_path / 'completed-duplicates.db'}")
    Base.metadata.create_all(engine)
    session_factory = build_session_factory(engine)
    with session_factory() as session:
        old_job = Job()
        old_document = document("a" * 64, "INV-OLD")
        old_job.documents.append(old_document)
        session.add(old_job)
        session.flush()
        completed = CompletedDocument(
            job=old_job,
            source_document=old_document,
            image_sha256=old_document.image_sha256,
        )
        session.add(completed)

        new_job = Job()
        uploaded = document("a" * 64, "DIFFERENT")
        uploaded.original_image_name = "renamed.png"
        new_job.documents.append(uploaded)
        session.add(new_job)
        session.flush()

        recalculate_job_duplicates(session, new_job.id)

        assert uploaded.duplicate_status == DuplicateStatus.CONFIRMED
    engine.dispose()
