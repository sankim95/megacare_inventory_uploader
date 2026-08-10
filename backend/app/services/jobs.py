from __future__ import annotations

from pathlib import Path
from typing import BinaryIO, List, Optional

from sqlalchemy import delete, func, insert, or_, select, update
from sqlalchemy.orm import Session

from app.models import (
    CompletedDocument,
    Document,
    DocumentStatus,
    Item,
    Job,
    JobStatus,
    ProductIndex,
)
from app.models.job import new_id, utc_now
from app.schemas.jobs import JobRead
from app.services.excel import (
    ExcelValidationError,
    ProductRecord,
    stage_excel_upload,
    validate_product_workbook,
)
from app.services.job_mutations import lock_job_for_mutation


class JobOperationError(ValueError):
    pass


def create_job(db: Session) -> JobRead:
    job = Job()
    db.add(job)
    db.commit()
    db.refresh(job)
    return _to_job_read(job, 0)


def list_jobs(db: Session) -> List[JobRead]:
    product_count = (
        select(func.count(ProductIndex.id))
        .where(ProductIndex.job_id == Job.id)
        .correlate(Job)
        .scalar_subquery()
    )
    rows = db.execute(
        select(Job, product_count.label("product_count")).order_by(Job.created_at.desc())
    ).all()
    return [_to_job_read(job, count) for job, count in rows]


def get_job(db: Session, job_id: str) -> Optional[JobRead]:
    row = db.execute(
        select(Job, func.count(ProductIndex.id))
        .outerjoin(ProductIndex, ProductIndex.job_id == Job.id)
        .where(Job.id == job_id)
        .group_by(Job.id)
    ).one_or_none()
    if row is None:
        return None
    return _to_job_read(row[0], row[1])


def delete_job(
    db: Session,
    job: Job,
    uploads_dir: Path,
    corrected_dir: Path,
    exports_dir: Path,
) -> None:
    locked = db.execute(
        update(Job)
        .where(
            Job.id == job.id,
            Job.status.not_in((JobStatus.EXTRACTING, JobStatus.EXPORTING)),
        )
        .values(updated_at=Job.updated_at)
        .execution_options(synchronize_session=False)
    )
    if locked.rowcount != 1:
        db.rollback()
        raise JobOperationError(
            "추출 또는 내보내기 중인 작업은 삭제할 수 없습니다. "
            "처리가 끝난 뒤 다시 시도해 주세요."
        )

    document_paths = db.execute(
        select(Document.original_image_path, Document.corrected_image_path).where(
            Document.job_id == job.id
        )
    ).all()
    original_excel_path = job.original_excel_path
    result_path = job.result_path

    db.execute(
        delete(CompletedDocument).where(CompletedDocument.job_id == job.id)
    )
    db.delete(job)
    db.commit()

    _remove_owned_file(original_excel_path, uploads_dir)
    for original_image_path, corrected_image_path in document_paths:
        _remove_owned_file(original_image_path, uploads_dir)
        _remove_owned_file(corrected_image_path, corrected_dir)
    _remove_owned_file(result_path, exports_dir)


def replace_job_excel(
    db: Session,
    job: Job,
    source: BinaryIO,
    original_filename: str,
    uploads_dir: Path,
) -> JobRead:
    if not lock_job_for_mutation(db, job.id):
        raise JobOperationError(
            "추출·내보내기 중이거나 완료된 작업의 상품리스트는 변경할 수 없습니다."
        )
    has_review_data = db.scalar(
        select(Item.id)
        .join(Document, Item.document_id == Document.id)
        .where(Document.job_id == job.id)
        .limit(1)
    )
    has_extraction_result = db.scalar(
        select(Document.id)
        .where(
            Document.job_id == job.id,
            or_(
                Document.status == DocumentStatus.COMPLETED,
                Document.model_response.is_not(None),
                Document.photo_supplier.is_not(None),
                Document.transaction_date.is_not(None),
                Document.invoice_number.is_not(None),
                Document.document_total.is_not(None),
                Document.raw_header_text.is_not(None),
            ),
        )
        .limit(1)
    )
    if has_review_data is not None or has_extraction_result is not None:
        raise JobOperationError(
            "추출 또는 검수 데이터가 있는 작업의 상품리스트는 교체할 수 없습니다. "
            "기존 결과를 보존하려면 새 작업을 만들어 주세요."
        )
    staged = stage_excel_upload(source, original_filename, uploads_dir)
    final_path = uploads_dir / staged.storage_name
    previous_path = Path(job.original_excel_path) if job.original_excel_path else None

    try:
        records = validate_product_workbook(staged.path)
        staged.path.replace(final_path)
        db.execute(delete(ProductIndex).where(ProductIndex.job_id == job.id))
        if records:
            db.execute(
                insert(ProductIndex),
                [_product_mapping(job.id, record) for record in records],
            )
        job.original_excel_path = str(final_path.resolve())
        job.original_excel_name = staged.original_name
        job.original_excel_sha256 = staged.sha256
        job.updated_at = utc_now()
        db.commit()
    except Exception:
        db.rollback()
        staged.path.unlink(missing_ok=True)
        final_path.unlink(missing_ok=True)
        raise

    _remove_previous_upload(previous_path, final_path, uploads_dir)
    return _to_job_read(job, len(records))


def clone_job(db: Session, source_job: Job, uploads_dir: Path) -> JobRead:
    if (
        not source_job.original_excel_path
        or not source_job.original_excel_sha256
    ):
        raise JobOperationError(
            "복제할 원본 Excel 정보가 없습니다. 상품리스트를 다시 확인해 주세요."
        )

    source_path = Path(source_job.original_excel_path)
    if not source_path.is_file():
        raise JobOperationError(
            "복제할 원본 Excel 파일을 찾을 수 없습니다."
        )

    original_name = source_job.original_excel_name or source_path.name
    staged = None
    final_path: Optional[Path] = None
    try:
        with source_path.open("rb") as source:
            staged = stage_excel_upload(source, original_name, uploads_dir)
        if staged.sha256 != source_job.original_excel_sha256:
            raise JobOperationError(
                "원본 Excel 파일이 업로드 이후 변경되어 작업을 복제할 수 없습니다."
            )

        records = validate_product_workbook(staged.path)
        final_path = uploads_dir / staged.storage_name
        staged.path.replace(final_path)

        cloned = Job(
            original_excel_path=str(final_path.resolve()),
            original_excel_name=original_name,
            original_excel_sha256=staged.sha256,
        )
        db.add(cloned)
        db.flush()
        if records:
            db.execute(
                insert(ProductIndex),
                [_product_mapping(cloned.id, record) for record in records],
            )
        db.commit()
        db.refresh(cloned)
        return _to_job_read(cloned, len(records))
    except JobOperationError:
        db.rollback()
        if staged is not None:
            staged.path.unlink(missing_ok=True)
        if final_path is not None:
            final_path.unlink(missing_ok=True)
        raise
    except ExcelValidationError as exc:
        db.rollback()
        if staged is not None:
            staged.path.unlink(missing_ok=True)
        if final_path is not None:
            final_path.unlink(missing_ok=True)
        raise JobOperationError(
            f"원본 Excel 파일을 다시 검증할 수 없습니다: {exc}"
        ) from exc
    except FileNotFoundError as exc:
        db.rollback()
        if staged is not None:
            staged.path.unlink(missing_ok=True)
        if final_path is not None:
            final_path.unlink(missing_ok=True)
        raise JobOperationError(
            "복제할 원본 Excel 파일을 찾을 수 없습니다."
        ) from exc
    except Exception:
        db.rollback()
        if staged is not None:
            staged.path.unlink(missing_ok=True)
        if final_path is not None:
            final_path.unlink(missing_ok=True)
        raise


def _product_mapping(job_id: str, record: ProductRecord) -> dict:
    return {
        "id": new_id(),
        "job_id": job_id,
        "product_code": record.product_code,
        "product_name": record.product_name,
        "specification": record.specification,
        "current_stock": record.current_stock,
        "purchase_price": record.purchase_price,
        "supplier_code": record.supplier_code,
        "supplier": record.supplier,
        "excel_row": record.excel_row,
        "created_at": utc_now(),
    }


def _remove_previous_upload(
    previous_path: Optional[Path], final_path: Path, uploads_dir: Path
) -> None:
    if previous_path is None or previous_path == final_path:
        return
    try:
        if previous_path.resolve().parent == uploads_dir.resolve():
            previous_path.unlink(missing_ok=True)
    except OSError:
        pass


def _remove_owned_file(stored_path: Optional[str], owned_dir: Path) -> None:
    if not stored_path:
        return
    try:
        path = Path(stored_path)
        resolved_path = path.resolve()
        resolved_dir = owned_dir.resolve()
        if resolved_path != resolved_dir and resolved_path.is_relative_to(resolved_dir):
            path.unlink(missing_ok=True)
    except OSError:
        pass


def _to_job_read(job: Job, product_count: int) -> JobRead:
    return JobRead.model_validate(job).model_copy(
        update={"product_count": product_count}
    )
