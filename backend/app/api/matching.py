from __future__ import annotations

from typing import Annotated, List

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models import Item, Job
from app.schemas.documents import (
    ItemRead,
    ManualMatchRequest,
    ProductCandidate,
    RegisterProductRequest,
)
from app.services.matching import (
    MatchingOperationError,
    clear_item_match,
    manually_match_item,
    match_job_items,
    register_item_product,
    search_products,
)


router = APIRouter(tags=["상품 매칭"])


@router.post("/jobs/{job_id}/match", response_model=List[ItemRead])
def match_job_items_endpoint(
    job_id: str, db: Annotated[Session, Depends(get_db)]
) -> List[ItemRead]:
    job = db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="작업을 찾을 수 없습니다.")
    try:
        return match_job_items(db, job)
    except MatchingOperationError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail="상품 매칭을 저장할 수 없습니다.") from exc


@router.get(
    "/jobs/{job_id}/products/search", response_model=List[ProductCandidate]
)
def search_products_endpoint(
    job_id: str,
    query: Annotated[str, Query(min_length=1, max_length=255)],
    db: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=5)] = 5,
) -> List[ProductCandidate]:
    if db.get(Job, job_id) is None:
        raise HTTPException(status_code=404, detail="작업을 찾을 수 없습니다.")
    normalized_query = query.strip()
    if not normalized_query:
        raise HTTPException(status_code=422, detail="검색어를 입력해 주세요.")
    return search_products(db, job_id, normalized_query, limit)


@router.put("/items/{item_id}/match", response_model=ItemRead)
def manually_match_item_endpoint(
    item_id: str,
    payload: ManualMatchRequest,
    db: Annotated[Session, Depends(get_db)],
) -> ItemRead:
    item = db.get(Item, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="품목을 찾을 수 없습니다.")
    try:
        return manually_match_item(
            db, item, payload.product_code, approve=payload.approve
        )
    except MatchingOperationError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail="수동 매칭을 저장할 수 없습니다.") from exc


@router.delete("/items/{item_id}/match", response_model=ItemRead)
def clear_item_match_endpoint(
    item_id: str, db: Annotated[Session, Depends(get_db)]
) -> ItemRead:
    item = db.get(Item, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="품목을 찾을 수 없습니다.")
    try:
        return clear_item_match(db, item)
    except MatchingOperationError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail="상품 매칭을 해제할 수 없습니다.") from exc


@router.post("/items/{item_id}/register-product", response_model=ItemRead)
def register_item_product_endpoint(
    item_id: str,
    payload: RegisterProductRequest,
    db: Annotated[Session, Depends(get_db)],
) -> ItemRead:
    item = db.get(Item, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="품목을 찾을 수 없습니다.")
    try:
        return register_item_product(db, item, payload)
    except MatchingOperationError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail="신규 상품을 등록할 수 없습니다.") from exc
