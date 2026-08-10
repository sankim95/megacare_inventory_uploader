from __future__ import annotations

from typing import Iterable, List

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Document, Item, Job
from app.models.job import utc_now
from app.schemas.documents import BulkItemUpdate, ItemRead, ItemUpdate
from app.services.duplicates import recalculate_job_duplicates
from app.services.item_rules import (
    ItemRuleError,
    ensure_job_mutable,
    validate_item_state,
)
from app.services.matching import recalculate_item_match
from app.services.review import recalculate_document_warnings


class ItemOperationError(ValueError):
    pass


def list_job_items(db: Session, job_id: str) -> List[ItemRead]:
    return [
        ItemRead.model_validate(item)
        for item in _ordered_items_query(db, job_id).all()
    ]


def update_item(db: Session, item: Item, payload: ItemUpdate) -> ItemRead:
    try:
        ensure_job_mutable(db, item.document.job)
        values = payload.model_dump(exclude_unset=True)
        explicit_purchase_price = "apply_purchase_price" in values
        requested_purchase_price = values.pop("apply_purchase_price", None)
        unit_price_changed = (
            "unit_price" in values and values["unit_price"] != item.unit_price
        )
        for field, value in values.items():
            setattr(item, field, value)

        recalculate_item_match(
            db,
            item,
            preserve_purchase_price=not unit_price_changed,
        )
        if explicit_purchase_price:
            item.apply_purchase_price = requested_purchase_price
        validate_item_state(
            item, explicit_purchase_price=explicit_purchase_price
        )
        item.updated_at = utc_now()
        recalculate_document_warnings(item.document)
        recalculate_job_duplicates(db, item.document.job_id)
        db.commit()
        db.refresh(item)
        return ItemRead.model_validate(item)
    except ItemRuleError as exc:
        db.rollback()
        raise ItemOperationError(str(exc)) from exc
    except Exception:
        db.rollback()
        raise


def bulk_update_items(
    db: Session, job: Job, payload: BulkItemUpdate
) -> List[ItemRead]:
    try:
        ensure_job_mutable(db, job)
        items = _select_bulk_items(db, job.id, payload)
        changes = payload.changes()
        explicit_purchase_price = "apply_purchase_price" in changes
        for item in items:
            for field, value in changes.items():
                setattr(item, field, value)
            validate_item_state(
                item, explicit_purchase_price=explicit_purchase_price
            )
            item.updated_at = utc_now()

        for document in _unique_documents(items):
            recalculate_document_warnings(document)
        recalculate_job_duplicates(db, job.id)
        job.updated_at = utc_now()
        db.commit()
        for item in items:
            db.refresh(item)
        return [ItemRead.model_validate(item) for item in items]
    except ItemRuleError as exc:
        db.rollback()
        raise ItemOperationError(str(exc)) from exc
    except ItemOperationError:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise


def _ordered_items_query(db: Session, job_id: str):
    return db.scalars(
        select(Item)
        .join(Document, Item.document_id == Document.id)
        .where(Document.job_id == job_id)
        .order_by(Document.source_order, Item.source_row_order)
    )


def _select_bulk_items(
    db: Session, job_id: str, payload: BulkItemUpdate
) -> list[Item]:
    query = (
        select(Item)
        .join(Document, Item.document_id == Document.id)
        .where(Document.job_id == job_id)
    )
    if payload.item_ids is not None:
        query = query.where(Item.id.in_(payload.item_ids))
    else:
        query = query.where(Item.review_status == payload.target_review_status)
    items = list(
        db.scalars(
            query.order_by(Document.source_order, Item.source_row_order)
        ).all()
    )
    if payload.item_ids is not None and {item.id for item in items} != set(
        payload.item_ids
    ):
        raise ItemOperationError(
            "선택한 품목 중 현재 작업에 속하지 않거나 찾을 수 없는 항목이 있습니다."
        )
    return items


def _unique_documents(items: Iterable[Item]) -> list[Document]:
    documents = {}
    for item in items:
        documents[item.document_id] = item.document
    return list(documents.values())
