from __future__ import annotations

from sqlalchemy import update
from sqlalchemy.orm import Session

from app.models import Job, JobStatus


def lock_job_for_mutation(db: Session, job_id: str) -> bool:
    """Validate mutability against the DB and hold a write lock to commit."""
    locked = db.execute(
        update(Job)
        .where(
            Job.id == job_id,
            Job.status.not_in(
                (JobStatus.EXTRACTING, JobStatus.EXPORTING, JobStatus.COMPLETED)
            ),
        )
        .values(updated_at=Job.updated_at)
        .execution_options(synchronize_session=False)
    )
    if locked.rowcount == 1:
        return True
    db.rollback()
    return False
