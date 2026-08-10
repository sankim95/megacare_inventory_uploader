from __future__ import annotations

from typing import Annotated, List

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import Response
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.database import get_db
from app.models import Job, JobStatus
from app.schemas.jobs import JobRead
from app.services.excel import ExcelValidationError
from app.services.jobs import (
    JobOperationError,
    clone_job,
    create_job,
    delete_job,
    get_job,
    list_jobs,
    replace_job_excel,
)

router = APIRouter(prefix="/jobs", tags=["작업"])


@router.post("", response_model=JobRead, status_code=status.HTTP_201_CREATED)
def create_job_endpoint(db: Annotated[Session, Depends(get_db)]) -> JobRead:
    try:
        return create_job(db)
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="작업을 생성할 수 없습니다.",
        ) from exc


@router.get("", response_model=List[JobRead])
def list_jobs_endpoint(db: Annotated[Session, Depends(get_db)]) -> List[JobRead]:
    try:
        return list_jobs(db)
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="작업 목록을 불러올 수 없습니다.",
        ) from exc


@router.get("/{job_id}", response_model=JobRead)
def get_job_endpoint(
    job_id: str, db: Annotated[Session, Depends(get_db)]
) -> JobRead:
    try:
        job = get_job(db, job_id)
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="작업을 불러올 수 없습니다.",
        ) from exc
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="작업을 찾을 수 없습니다.",
        )
    return job


@router.delete("/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_job_endpoint(
    job_id: str,
    db: Annotated[Session, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Response:
    job = db.get(Job, job_id)
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="작업을 찾을 수 없습니다.",
        )
    try:
        delete_job(
            db,
            job,
            settings.data_dir / "uploads",
            settings.data_dir / "corrected",
            settings.data_dir / "exports",
        )
    except JobOperationError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="작업을 삭제할 수 없습니다.",
        ) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{job_id}/excel", response_model=JobRead)
def upload_excel_endpoint(
    job_id: str,
    file: Annotated[UploadFile, File(description=".xlsx 상품리스트")],
    db: Annotated[Session, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> JobRead:
    try:
        job = db.get(Job, job_id)
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="작업을 불러올 수 없습니다.",
        ) from exc
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="작업을 찾을 수 없습니다.",
        )
    if job.status in {
        JobStatus.EXTRACTING,
        JobStatus.EXPORTING,
        JobStatus.COMPLETED,
    }:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="추출·내보내기 중이거나 완료된 작업의 상품리스트는 변경할 수 없습니다.",
        )

    try:
        return replace_job_excel(
            db=db,
            job=job,
            source=file.file,
            original_filename=file.filename or "",
            uploads_dir=settings.data_dir / "uploads",
        )
    except JobOperationError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from exc
    except ExcelValidationError as exc:
        raise HTTPException(
            status_code=422,
            detail=str(exc),
        ) from exc
    except (OSError, SQLAlchemyError) as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="상품리스트를 저장할 수 없습니다.",
        ) from exc


@router.post(
    "/{job_id}/clone",
    response_model=JobRead,
    status_code=status.HTTP_201_CREATED,
)
def clone_job_endpoint(
    job_id: str,
    db: Annotated[Session, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> JobRead:
    job = db.get(Job, job_id)
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="작업을 찾을 수 없습니다.",
        )
    try:
        return clone_job(db, job, settings.data_dir / "uploads")
    except JobOperationError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from exc
    except (OSError, SQLAlchemyError) as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="작업을 복제할 수 없습니다.",
        ) from exc
