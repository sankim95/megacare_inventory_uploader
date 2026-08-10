from __future__ import annotations

from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.database import get_db
from app.models import Job, JobStatus
from app.schemas.exports import (
    ExportRequest,
    PriceResolutionRequest,
    ReviewSummaryRead,
)
from app.schemas.jobs import JobRead
from app.services.exports import (
    ExportExecutionError,
    ExportOperationError,
    export_job,
)
from app.services.summary import (
    SummaryOperationError,
    build_review_summary,
    set_manual_price_resolution,
)


router = APIRouter(prefix="/jobs", tags=["내보내기"])
XLSX_MEDIA_TYPE = (
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
)


@router.get("/{job_id}/review-summary", response_model=ReviewSummaryRead)
def review_summary_endpoint(
    job_id: str, db: Annotated[Session, Depends(get_db)]
) -> ReviewSummaryRead:
    job = db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="작업을 찾을 수 없습니다.")
    try:
        summary = build_review_summary(db, job)
        db.rollback()
        return summary
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=500, detail="검수 요약을 계산할 수 없습니다."
        ) from exc


@router.put(
    "/{job_id}/price-resolutions/{product_code}",
    response_model=ReviewSummaryRead,
)
def price_resolution_endpoint(
    job_id: str,
    product_code: str,
    payload: PriceResolutionRequest,
    db: Annotated[Session, Depends(get_db)],
) -> ReviewSummaryRead:
    job = db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="작업을 찾을 수 없습니다.")
    try:
        return set_manual_price_resolution(
            db,
            job,
            product_code.strip(),
            payload.selected_item_id,
        )
    except SummaryOperationError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=500, detail="대표 단가를 저장할 수 없습니다."
        ) from exc


@router.post("/{job_id}/export", response_model=JobRead)
def export_job_endpoint(
    job_id: str,
    payload: ExportRequest,
    db: Annotated[Session, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> JobRead:
    job = db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="작업을 찾을 수 없습니다.")
    try:
        return export_job(db, job, payload.approved_by, settings)
    except ExportOperationError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except (ExportExecutionError, SQLAlchemyError, OSError) as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Excel 결과를 생성하거나 검증할 수 없습니다.",
        ) from exc


@router.get("/{job_id}/result")
def download_result_endpoint(
    job_id: str, db: Annotated[Session, Depends(get_db)]
) -> FileResponse:
    job = db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="작업을 찾을 수 없습니다.")
    if job.status != JobStatus.COMPLETED:
        raise HTTPException(
            status_code=409, detail="아직 완료된 내보내기 결과가 없습니다."
        )
    if not job.result_path or not Path(job.result_path).is_file():
        raise HTTPException(
            status_code=404, detail="완료 결과 파일을 찾을 수 없습니다."
        )
    return FileResponse(
        job.result_path,
        media_type=XLSX_MEDIA_TYPE,
        filename=Path(job.result_path).name,
    )
