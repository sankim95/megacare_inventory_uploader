from __future__ import annotations

import mimetypes
from pathlib import Path
from typing import Annotated, List, Literal

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse, Response
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.database import get_db
from app.models import Document, Item, Job, JobStatus
from app.schemas.documents import (
    BulkItemUpdate,
    DocumentDetailRead,
    DocumentRead,
    DocumentUpdate,
    ItemRead,
    ItemUpdate,
    ManualItemCreate,
)
from app.services.documents import (
    DocumentOperationError,
    add_manual_item,
    delete_document,
    get_document_detail,
    list_documents,
    update_document,
    upload_documents,
)
from app.services.extraction import (
    ExtractionOperationError,
    extract_job_documents,
    retry_document_extraction,
)
from app.services.items import (
    ItemOperationError,
    bulk_update_items,
    list_job_items,
    update_item,
)


router = APIRouter(tags=["거래명세서"])


@router.post("/jobs/{job_id}/documents", response_model=List[DocumentRead])
def upload_documents_endpoint(
    job_id: str,
    files: Annotated[List[UploadFile], File(description="거래명세서 이미지")],
    db: Annotated[Session, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> List[DocumentRead]:
    if not files:
        raise HTTPException(status_code=422, detail="이미지를 하나 이상 선택해 주세요.")
    job = db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="작업을 찾을 수 없습니다.")
    if job.status in {
        JobStatus.EXTRACTING,
        JobStatus.EXPORTING,
        JobStatus.COMPLETED,
    }:
        raise HTTPException(
            status_code=409,
            detail="추출·내보내기 중이거나 완료된 작업에는 이미지를 추가할 수 없습니다.",
        )
    try:
        return upload_documents(
            db=db,
            job=job,
            files=files,
            uploads_dir=settings.data_dir / "uploads",
            corrected_dir=settings.data_dir / "corrected",
        )
    except DocumentOperationError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=500, detail="거래명세서 정보를 저장할 수 없습니다."
        ) from exc
    except OSError as exc:
        raise HTTPException(
            status_code=500, detail="거래명세서 이미지 파일을 저장할 수 없습니다."
        ) from exc


@router.get("/jobs/{job_id}/documents", response_model=List[DocumentRead])
def list_documents_endpoint(
    job_id: str, db: Annotated[Session, Depends(get_db)]
) -> List[DocumentRead]:
    if db.get(Job, job_id) is None:
        raise HTTPException(status_code=404, detail="작업을 찾을 수 없습니다.")
    return list_documents(db, job_id)


@router.get("/jobs/{job_id}/items", response_model=List[ItemRead])
def list_job_items_endpoint(
    job_id: str, db: Annotated[Session, Depends(get_db)]
) -> List[ItemRead]:
    if db.get(Job, job_id) is None:
        raise HTTPException(status_code=404, detail="작업을 찾을 수 없습니다.")
    return list_job_items(db, job_id)


@router.patch("/jobs/{job_id}/items/bulk", response_model=List[ItemRead])
def bulk_update_items_endpoint(
    job_id: str,
    payload: BulkItemUpdate,
    db: Annotated[Session, Depends(get_db)],
) -> List[ItemRead]:
    job = db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="작업을 찾을 수 없습니다.")
    try:
        return bulk_update_items(db, job, payload)
    except ItemOperationError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=500, detail="품목을 일괄 수정할 수 없습니다."
        ) from exc


@router.post("/jobs/{job_id}/extract", response_model=List[DocumentRead])
def extract_job_documents_endpoint(
    job_id: str,
    db: Annotated[Session, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> List[DocumentRead]:
    job = db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="작업을 찾을 수 없습니다.")
    try:
        return extract_job_documents(db, job, settings)
    except ExtractionOperationError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail="추출 작업을 저장할 수 없습니다.") from exc


@router.get("/documents/{document_id}", response_model=DocumentDetailRead)
def get_document_endpoint(
    document_id: str, db: Annotated[Session, Depends(get_db)]
) -> DocumentDetailRead:
    detail = get_document_detail(db, document_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="거래명세서를 찾을 수 없습니다.")
    return detail


@router.patch("/documents/{document_id}", response_model=DocumentRead)
def update_document_endpoint(
    document_id: str,
    payload: DocumentUpdate,
    db: Annotated[Session, Depends(get_db)],
) -> DocumentRead:
    document = db.get(Document, document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="거래명세서를 찾을 수 없습니다.")
    try:
        return update_document(db, document, payload)
    except DocumentOperationError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=500, detail="거래명세서 정보를 수정할 수 없습니다."
        ) from exc


@router.delete(
    "/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT
)
def delete_document_endpoint(
    document_id: str,
    db: Annotated[Session, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Response:
    document = db.get(Document, document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="거래명세서를 찾을 수 없습니다.")
    try:
        delete_document(
            db,
            document,
            settings.data_dir / "uploads",
            settings.data_dir / "corrected",
        )
    except DocumentOperationError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=500, detail="거래명세서를 삭제할 수 없습니다."
        ) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/documents/{document_id}/image")
def get_document_image_endpoint(
    document_id: str,
    db: Annotated[Session, Depends(get_db)],
    variant: Annotated[
        Literal["original", "corrected"], Query(description="이미지 종류")
    ] = "original",
) -> FileResponse:
    document = db.get(Document, document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="거래명세서를 찾을 수 없습니다.")
    stored_path = (
        document.original_image_path
        if variant == "original"
        else document.corrected_image_path
    )
    if not stored_path or not Path(stored_path).is_file():
        label = "원본" if variant == "original" else "보정"
        raise HTTPException(status_code=404, detail=f"{label} 이미지를 찾을 수 없습니다.")
    media_type = mimetypes.guess_type(stored_path)[0] or "application/octet-stream"
    return FileResponse(stored_path, media_type=media_type)


@router.post("/documents/{document_id}/extract", response_model=DocumentRead)
def retry_document_extraction_endpoint(
    document_id: str,
    db: Annotated[Session, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> DocumentRead:
    document = db.get(Document, document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="거래명세서를 찾을 수 없습니다.")
    try:
        return retry_document_extraction(db, document, settings)
    except ExtractionOperationError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail="추출 결과를 저장할 수 없습니다.") from exc


@router.post(
    "/documents/{document_id}/items",
    response_model=ItemRead,
    status_code=status.HTTP_201_CREATED,
)
def add_manual_item_endpoint(
    document_id: str,
    payload: ManualItemCreate,
    db: Annotated[Session, Depends(get_db)],
) -> ItemRead:
    document = db.get(Document, document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="거래명세서를 찾을 수 없습니다.")
    try:
        return add_manual_item(db, document, payload)
    except DocumentOperationError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail="수기 품목을 저장할 수 없습니다.") from exc


@router.patch("/items/{item_id}", response_model=ItemRead)
def update_item_endpoint(
    item_id: str,
    payload: ItemUpdate,
    db: Annotated[Session, Depends(get_db)],
) -> ItemRead:
    item = db.get(Item, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="품목을 찾을 수 없습니다.")
    try:
        return update_item(db, item, payload)
    except ItemOperationError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail="품목을 수정할 수 없습니다.") from exc
