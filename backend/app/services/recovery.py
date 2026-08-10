from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Document, DocumentStatus, Job, JobStatus
from app.models.job import utc_now


INTERRUPTED_EXTRACTION_MESSAGE = (
    "이전 추출 작업이 중단되었습니다. 다시 시도해 주세요."
)


def recover_interrupted_extractions(
    db: Session, exports_dir: Path | None = None
) -> None:
    interrupted_documents = db.scalars(
        select(Document).where(Document.status == DocumentStatus.PROCESSING)
    ).all()
    extracting_jobs = db.scalars(
        select(Job).where(Job.status == JobStatus.EXTRACTING)
    ).all()
    exporting_jobs = db.scalars(
        select(Job).where(Job.status == JobStatus.EXPORTING)
    ).all()

    if not interrupted_documents and not extracting_jobs and not exporting_jobs:
        return

    now = utc_now()
    for document in interrupted_documents:
        document.status = DocumentStatus.FAILED
        document.processing_error = INTERRUPTED_EXTRACTION_MESSAGE
        document.updated_at = now

    for job in extracting_jobs:
        job.status = JobStatus.REVIEWING if job.original_excel_path else JobStatus.DRAFT
        job.extraction_attempt_id = None
        job.updated_at = now

    for job in exporting_jobs:
        job.status = JobStatus.REVIEWING if job.original_excel_path else JobStatus.DRAFT
        job.result_path = None
        job.approved_by = None
        job.completed_at = None
        job.export_attempt_id = None
        job.updated_at = now

    db.commit()
    if exporting_jobs and exports_dir is not None:
        _remove_unconfirmed_exports(db, exports_dir)


def _remove_unconfirmed_exports(db: Session, exports_dir: Path) -> None:
    if not exports_dir.is_dir():
        return
    completed_paths = {
        Path(path).resolve()
        for path in db.scalars(
            select(Job.result_path).where(
                Job.status == JobStatus.COMPLETED,
                Job.result_path.is_not(None),
            )
        ).all()
        if path
    }
    for path in exports_dir.glob("*상품리스트_입고반영_*.xlsx"):
        if path.resolve() not in completed_paths:
            path.unlink(missing_ok=True)
