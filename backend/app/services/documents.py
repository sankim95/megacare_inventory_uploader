from __future__ import annotations

from pathlib import Path
from typing import Iterable, List, Optional

from fastapi import UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.models import (
    Document,
    DocumentStatus,
    DuplicateStatus,
    Item,
    Job,
)
from app.models.job import utc_now
from app.schemas.documents import (
    DocumentDetailRead,
    DocumentRead,
    DocumentUpdate,
    ItemRead,
    ManualItemCreate,
)
from app.services.images import (
    StoredInvalidImage,
    correct_document_image,
    store_uploaded_image,
)
from app.services.job_mutations import lock_job_for_mutation
from app.services.duplicates import (
    current_documents_with_image_hash,
    has_completed_image_hash,
    recalculate_job_duplicates,
)


class DocumentOperationError(ValueError):
    pass


def upload_documents(
    db: Session,
    job: Job,
    files: Iterable[UploadFile],
    uploads_dir: Path,
    corrected_dir: Path,
) -> List[DocumentRead]:
    next_order = (
        db.scalar(
            select(func.coalesce(func.max(Document.source_order), -1)).where(
                Document.job_id == job.id
            )
        )
        + 1
    )
    results: List[DocumentRead] = []
    for offset, upload in enumerate(files):
        _ensure_job_mutable(db, job)
        source_order = next_order + offset
        original_name = _safe_original_name(upload.filename)
        stored_path: Optional[Path] = None
        corrected_path: Optional[Path] = None
        try:
            stored = store_uploaded_image(
                upload.file, upload.content_type, uploads_dir
            )
            stored_path = stored.path
            current_duplicates = current_documents_with_image_hash(
                db, job.id, stored.sha256
            )
            is_completed_duplicate = has_completed_image_hash(db, stored.sha256)
            if current_duplicates or is_completed_duplicate:
                document = Document(
                    job_id=job.id,
                    source_order=source_order,
                    original_image_path=str(stored.path),
                    original_image_name=original_name,
                    image_sha256=stored.sha256,
                    status=DocumentStatus.FAILED,
                    duplicate_status=DuplicateStatus.CONFIRMED,
                    correction_applied=False,
                    processing_error=(
                        "이미 처리했거나 현재 작업에 포함된 동일 이미지입니다. "
                        "중복 여부를 확인해 주세요."
                    ),
                )
            else:
                correction = correct_document_image(stored.path, corrected_dir)
                corrected_path = correction.path
                document = Document(
                    job_id=job.id,
                    source_order=source_order,
                    original_image_path=str(stored.path),
                    original_image_name=original_name,
                    corrected_image_path=(
                        str(correction.path) if correction.path is not None else None
                    ),
                    image_sha256=stored.sha256,
                    status=DocumentStatus.PENDING,
                    correction_applied=correction.applied,
                    correction_warning=correction.warning,
                )
        except StoredInvalidImage as exc:
            stored_path = exc.path
            document = Document(
                job_id=job.id,
                source_order=source_order,
                original_image_path=str(exc.path),
                original_image_name=original_name,
                image_sha256=exc.sha256,
                status=DocumentStatus.FAILED,
                correction_applied=False,
                correction_warning=None,
                processing_error=str(exc),
            )

        try:
            db.add(document)
            db.flush()
            recalculate_job_duplicates(db, job.id)
            job.updated_at = utc_now()
            db.commit()
            db.refresh(document)
            results.append(to_document_read(document))
        except Exception:
            db.rollback()
            if stored_path is not None:
                stored_path.unlink(missing_ok=True)
            if corrected_path is not None:
                corrected_path.unlink(missing_ok=True)
            raise
    return results


def list_documents(db: Session, job_id: str) -> List[DocumentRead]:
    documents = db.scalars(
        select(Document)
        .where(Document.job_id == job_id)
        .order_by(Document.source_order)
    ).all()
    return [to_document_read(document) for document in documents]


def get_document_detail(
    db: Session, document_id: str
) -> Optional[DocumentDetailRead]:
    document = db.scalar(
        select(Document)
        .options(selectinload(Document.items))
        .where(Document.id == document_id)
    )
    if document is None:
        return None
    items = sorted(document.items, key=lambda item: item.source_row_order)
    return DocumentDetailRead(
        **to_document_read(document).model_dump(),
        raw_header_text=document.raw_header_text,
        confidence_by_field=document.confidence_by_field,
        items=[ItemRead.model_validate(item) for item in items],
    )


def update_document(
    db: Session, document: Document, payload: DocumentUpdate
) -> DocumentRead:
    _ensure_job_mutable(db, document.job)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(document, field, value)
    from app.services.review import recalculate_document_warnings

    recalculate_document_warnings(document)
    document.updated_at = utc_now()
    recalculate_job_duplicates(db, document.job_id)
    document.job.updated_at = utc_now()
    db.commit()
    db.refresh(document)
    return to_document_read(document)


def delete_document(
    db: Session,
    document: Document,
    uploads_dir: Path,
    corrected_dir: Path,
) -> None:
    _ensure_job_mutable(db, document.job)
    original_path = document.original_image_path
    corrected_path = document.corrected_image_path
    job = document.job
    job_id = document.job_id

    db.delete(document)
    db.flush()
    recalculate_job_duplicates(db, job_id)
    job.updated_at = utc_now()
    db.commit()

    _remove_owned_file(original_path, uploads_dir)
    _remove_owned_file(corrected_path, corrected_dir)


def add_manual_item(
    db: Session, document: Document, payload: ManualItemCreate
) -> ItemRead:
    _ensure_job_mutable(db, document.job)
    next_order = (
        db.scalar(
            select(func.coalesce(func.max(Item.source_row_order), -1)).where(
                Item.document_id == document.id
            )
        )
        + 1
    )
    values = payload.model_dump()
    if "stock_increment" not in payload.model_fields_set:
        values["stock_increment"] = payload.quantity
    item = Item(
        document_id=document.id,
        source_row_order=next_order,
        is_manual=True,
        **values,
    )
    db.add(item)
    db.flush()
    from app.services.matching import recalculate_item_match
    from app.services.review import recalculate_document_warnings

    recalculate_item_match(db, item)
    recalculate_document_warnings(document)
    recalculate_job_duplicates(db, document.job_id)
    db.commit()
    db.refresh(item)
    return ItemRead.model_validate(item)


def to_document_read(document: Document) -> DocumentRead:
    return DocumentRead(
        id=document.id,
        job_id=document.job_id,
        source_order=document.source_order,
        original_image_name=document.original_image_name,
        status=document.status,
        duplicate_status=document.duplicate_status,
        image_sha256=document.image_sha256,
        has_corrected_image=bool(document.corrected_image_path),
        correction_applied=document.correction_applied,
        correction_warning=document.correction_warning,
        photo_supplier=document.photo_supplier,
        transaction_date=document.transaction_date,
        invoice_number=document.invoice_number,
        document_total=document.document_total,
        processing_error=document.processing_error,
        model_name=document.model_name,
        prompt_version=document.prompt_version,
        created_at=document.created_at,
        updated_at=document.updated_at,
    )


def _ensure_job_mutable(db: Session, job: Job) -> None:
    if not lock_job_for_mutation(db, job.id):
        raise DocumentOperationError(
            "추출·내보내기 중이거나 완료된 작업은 변경할 수 없습니다."
        )


def _safe_original_name(filename: Optional[str]) -> str:
    name = (filename or "").replace("\\", "/").rsplit("/", 1)[-1].strip()
    return (name or "이름 없는 이미지")[:255]


def _remove_owned_file(stored_path: Optional[str], owned_dir: Path) -> None:
    if not stored_path:
        return
    try:
        path = Path(stored_path)
        resolved_path = path.resolve()
        resolved_dir = owned_dir.resolve()
        if resolved_path != resolved_dir and resolved_path.is_relative_to(
            resolved_dir
        ):
            path.unlink(missing_ok=True)
    except OSError:
        pass
