from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from sqlalchemy import case, delete, or_, select, text, update
from sqlalchemy.orm import Session, selectinload

from app.core.config import Settings
from app.models import (
    CompletedDocument,
    Document,
    Item,
    Job,
    JobStatus,
    ProductIndex,
    ReviewStatus,
)
from app.models.job import utc_now
from app.schemas.exports import ReviewSummaryRead
from app.schemas.jobs import JobRead
from app.services.duplicates import (
    build_document_identity_key,
    build_item_signature,
)
from app.services.excel import (
    HistorySheetAppend,
    InventoryCellUpdate,
    RegisteredProductRow,
    create_inventory_copy,
    sha256_file,
)
from app.services.jobs import get_job
from app.services.summary import build_review_summary


INVENTORY_HISTORY_HEADERS = (
    "작업 ID",
    "원본 Excel SHA-256",
    "문서 ID",
    "문서명",
    "이미지 SHA-256",
    "거래일자",
    "품목 ID",
    "OCR 원문",
    "OCR 상품명",
    "OCR 규격",
    "OCR 수량",
    "OCR 단가",
    "OCR 금액",
    "수정 상품명",
    "수정 규격",
    "수정 수량",
    "수정 단가",
    "수정 금액",
    "상품코드",
    "매칭 상품명",
    "매칭 방식",
    "매칭 점수",
    "기준 재고",
    "입고 수량",
    "변경 후 재고",
    "기준 매입단가",
    "변경 후 매입단가",
    "재고 반영",
    "매입단가 반영",
    "경고",
    "메모",
    "승인자",
    "승인 시각",
)

EXCLUSION_HISTORY_HEADERS = (
    "작업 ID",
    "원본 Excel SHA-256",
    "문서 ID",
    "문서명",
    "이미지 SHA-256",
    "거래일자",
    "품목 ID",
    "OCR 원문",
    "OCR 상품명",
    "OCR 규격",
    "OCR 수량",
    "OCR 단가",
    "OCR 금액",
    "수정 상품명",
    "수정 규격",
    "수정 수량",
    "수정 단가",
    "수정 금액",
    "마지막 후보",
    "제외 사유",
    "경고",
    "메모",
    "검수자",
    "검수 시각",
)


class ExportOperationError(ValueError):
    pass


class ExportExecutionError(RuntimeError):
    pass


def export_job(
    db: Session, job: Job, approved_by: str, settings: Settings
) -> JobRead:
    job_id = job.id
    if (
        job.status == JobStatus.COMPLETED
        and job.result_path
        and Path(job.result_path).is_file()
    ):
        result = get_job(db, job.id)
        if result is None:
            raise ExportExecutionError("완료된 작업 정보를 찾을 수 없습니다.")
        return result
    if job.status == JobStatus.EXPORTING:
        raise ExportOperationError("이미 내보내기 중인 작업입니다.")
    if job.status == JobStatus.COMPLETED:
        raise ExportOperationError("완료 결과 파일을 찾을 수 없습니다.")

    attempt_id = str(uuid4())
    if not _acquire_export_lock(db, job_id, attempt_id):
        db.expire_all()
        current = db.get(Job, job_id)
        if current is None:
            raise ExportExecutionError("작업 정보를 찾을 수 없습니다.")
        if (
            current.status == JobStatus.COMPLETED
            and current.result_path
            and Path(current.result_path).is_file()
        ):
            result = get_job(db, job_id)
            if result is None:
                raise ExportExecutionError("완료된 작업 정보를 찾을 수 없습니다.")
            return result
        if current.status == JobStatus.EXPORTING:
            raise ExportOperationError("이미 내보내기 중인 작업입니다.")
        if current.status == JobStatus.COMPLETED:
            raise ExportOperationError("완료 결과 파일을 찾을 수 없습니다.")
        raise ExportOperationError("내보내기 잠금을 획득할 수 없습니다.")

    destination_path: Path | None = None
    try:
        db.expire_all()
        job = db.get(Job, job_id)
        if job is None:
            raise ExportExecutionError("작업 정보를 찾을 수 없습니다.")
        summary = build_review_summary(db, job)
        if summary.blockers:
            messages = " ".join(blocker.message for blocker in summary.blockers)
            raise ExportOperationError(messages)
        source_path = _verified_source_path(job)

        now = datetime.now(settings.timezone)
        destination_path = settings.data_dir / "exports" / (
            f"상품리스트_입고반영_{now:%Y%m%d_%H%M%S}_"
            f"{job.id[:8]}_{attempt_id[:8]}.xlsx"
        )
        completed_at = utc_now()
        updates = _inventory_updates(db, job.id, summary)
        histories = _history_sheets(
            db,
            job,
            summary,
            approved_by,
            completed_at.astimezone(settings.timezone).isoformat(),
        )
        registered_products = _registered_product_rows(db, job.id, summary)
        if registered_products:
            create_inventory_copy(
                source_path,
                destination_path,
                updates,
                histories,
                registered_products,
            )
        else:
            create_inventory_copy(
                source_path,
                destination_path,
                updates,
                histories,
            )
        if sha256_file(source_path) != job.original_excel_sha256:
            raise ExportExecutionError(
                "원본 Excel 해시가 변경되어 완료를 확정할 수 없습니다."
            )

        _begin_completion_transaction(db)
        if not _owns_export_attempt(db, job_id, attempt_id):
            raise ExportExecutionError(
                "내보내기 잠금 소유권이 변경되어 완료를 확정할 수 없습니다."
            )
        documents = list(
            db.scalars(
                select(Document)
                .options(selectinload(Document.items))
                .where(Document.job_id == job_id)
                .order_by(Document.source_order)
            ).all()
        )
        for document in documents:
            identity_key = build_document_identity_key(document)
            item_signature = build_item_signature(document)
            _ensure_not_completed_duplicate(
                db,
                document.image_sha256,
                identity_key,
                item_signature,
            )
            document.document_identity_key = identity_key
            document.item_signature = item_signature
            db.add(
                CompletedDocument(
                    job_id=job_id,
                    source_document_id=document.id,
                    image_sha256=document.image_sha256,
                    document_identity_key=identity_key,
                    item_signature=item_signature,
                    completed_at=completed_at,
                )
            )
        finalized = db.execute(
            update(Job)
            .where(
                Job.id == job_id,
                Job.status == JobStatus.EXPORTING,
                Job.export_attempt_id == attempt_id,
            )
            .values(
                status=JobStatus.COMPLETED,
                result_path=str(destination_path.resolve()),
                approved_by=approved_by,
                completed_at=completed_at,
                failure_message=None,
                export_attempt_id=None,
                updated_at=completed_at,
            )
        )
        if finalized.rowcount != 1:
            raise ExportExecutionError(
                "내보내기 잠금 소유권이 변경되어 완료를 확정할 수 없습니다."
            )
        _commit_export_success(db)
        db.expire_all()
        result = get_job(db, job_id)
        if result is None:
            raise ExportExecutionError("완료된 작업 정보를 찾을 수 없습니다.")
        return result
    except ExportOperationError:
        db.rollback()
        _rollback_export(db, job_id, destination_path, attempt_id)
        raise
    except Exception as exc:
        db.rollback()
        _rollback_export(db, job_id, destination_path, attempt_id)
        if isinstance(exc, ExportExecutionError):
            raise
        raise ExportExecutionError(
            "Excel 출력 검증 또는 완료 확정에 실패했습니다."
        ) from exc


def _acquire_export_lock(db: Session, job_id: str, attempt_id: str) -> bool:
    acquired = db.execute(
        update(Job)
        .where(
            Job.id == job_id,
            Job.status.in_(
                (JobStatus.DRAFT, JobStatus.REVIEWING, JobStatus.FAILED)
            ),
        )
        .values(
            status=JobStatus.EXPORTING,
            export_attempt_id=attempt_id,
            failure_message=None,
            updated_at=utc_now(),
        )
    )
    db.commit()
    return acquired.rowcount == 1


def _begin_completion_transaction(db: Session) -> None:
    db.rollback()
    if db.get_bind().dialect.name == "sqlite":
        db.execute(text("BEGIN IMMEDIATE"))
        return
    db.execute(select(Job.id).order_by(Job.id).with_for_update()).all()


def _owns_export_attempt(db: Session, job_id: str, attempt_id: str) -> bool:
    owned = db.execute(
        update(Job)
        .where(
            Job.id == job_id,
            Job.status == JobStatus.EXPORTING,
            Job.export_attempt_id == attempt_id,
        )
        .values(updated_at=Job.updated_at)
        .execution_options(synchronize_session=False)
    )
    return owned.rowcount == 1


def _ensure_not_completed_duplicate(
    db: Session,
    image_sha256: str,
    document_identity_key: str | None,
    item_signature: str | None,
) -> None:
    conditions = [CompletedDocument.image_sha256 == image_sha256]
    if document_identity_key:
        conditions.append(
            CompletedDocument.document_identity_key == document_identity_key
        )
    if item_signature:
        conditions.append(CompletedDocument.item_signature == item_signature)
    duplicate = db.scalar(
        select(CompletedDocument.id).where(or_(*conditions)).limit(1)
    )
    if duplicate is not None:
        raise ExportOperationError(
            "이미 완료된 확정 중복 거래명세서가 있어 내보낼 수 없습니다."
        )


def _verified_source_path(job: Job) -> Path:
    if not job.original_excel_path or not job.original_excel_sha256:
        raise ExportOperationError("원본 상품리스트 Excel이 없습니다.")
    source_path = Path(job.original_excel_path)
    if not source_path.is_file():
        raise ExportOperationError("원본 상품리스트 Excel 파일을 찾을 수 없습니다.")
    if sha256_file(source_path) != job.original_excel_sha256:
        raise ExportOperationError(
            "원본 Excel 해시가 업로드 당시와 달라 내보낼 수 없습니다."
        )
    return source_path


def _inventory_updates(
    db: Session, job_id: str, summary: ReviewSummaryRead
) -> list[InventoryCellUpdate]:
    products = {
        product.product_code: product
        for product in db.scalars(
            select(ProductIndex).where(ProductIndex.job_id == job_id)
        ).all()
    }
    updates: list[InventoryCellUpdate] = []
    for row in summary.products:
        has_inventory_update = row.stock_increment != 0 or any(
            _approved_inventory_item(db, item_id) for item_id in row.item_ids
        )
        has_price_update = bool(row.price_candidates)
        if not has_inventory_update and not has_price_update:
            continue
        product = products[row.product_code]
        if product.is_user_created:
            continue
        updates.append(
            InventoryCellUpdate(
                excel_row=product.excel_row,
                expected_product_code=row.product_code,
                current_stock=(row.final_stock if has_inventory_update else None),
                purchase_price=(
                    row.final_purchase_price if has_price_update else None
                ),
            )
        )
    return updates


def _registered_product_rows(
    db: Session, job_id: str, summary: ReviewSummaryRead
) -> list[RegisteredProductRow]:
    summary_by_code = {row.product_code: row for row in summary.products}
    products = db.scalars(
        select(ProductIndex)
        .where(
            ProductIndex.job_id == job_id,
            ProductIndex.is_user_created.is_(True),
        )
        .order_by(ProductIndex.excel_row)
    ).all()
    rows: list[RegisteredProductRow] = []
    for product in products:
        reviewed = summary_by_code.get(product.product_code)
        if reviewed is None or reviewed.final_stock is None:
            continue
        rows.append(
            RegisteredProductRow(
                excel_row=product.excel_row,
                product_code=product.product_code,
                product_name=product.product_name or "",
                specification=product.specification,
                current_stock=reviewed.final_stock,
                purchase_price=reviewed.final_purchase_price,
                supplier_code=product.supplier_code,
                supplier=product.supplier,
            )
        )
    return rows


def _approved_inventory_item(db: Session, item_id: str) -> bool:
    item = db.get(Item, item_id)
    return bool(
        item is not None
        and item.review_status == ReviewStatus.APPROVED
        and item.apply_inventory
    )


def _history_sheets(
    db: Session,
    job: Job,
    summary: ReviewSummaryRead,
    approved_by: str,
    approved_at: str,
) -> tuple[HistorySheetAppend, HistorySheetAppend]:
    items = list(
        db.scalars(
            select(Item)
            .join(Document, Item.document_id == Document.id)
            .where(Document.job_id == job.id)
            .order_by(Document.source_order, Item.source_row_order)
        ).all()
    )
    products = {
        product.product_code: product for product in summary.products
    }
    approved_rows = [
        _approved_history_row(
            job,
            item,
            products.get(item.matched_product_code or ""),
            approved_by,
            approved_at,
        )
        for item in items
        if item.review_status == ReviewStatus.APPROVED
    ]
    excluded_rows = [
        _excluded_history_row(job, item, approved_by, approved_at)
        for item in items
        if item.review_status == ReviewStatus.EXCLUDED
    ]
    return (
        HistorySheetAppend(
            sheet_name="입고반영내역",
            headers=INVENTORY_HISTORY_HEADERS,
            rows=approved_rows,
        ),
        HistorySheetAppend(
            sheet_name="검수제외내역",
            headers=EXCLUSION_HISTORY_HEADERS,
            rows=excluded_rows,
        ),
    )


def _approved_history_row(
    job: Job, item: Item, product, approved_by: str, approved_at: str
) -> tuple:
    document = item.document
    return (
        job.id,
        job.original_excel_sha256,
        document.id,
        document.original_image_name,
        document.image_sha256,
        (
            document.transaction_date.isoformat()
            if document.transaction_date is not None
            else None
        ),
        item.id,
        item.raw_row_text,
        item.ocr_product_name,
        item.ocr_specification,
        item.ocr_quantity,
        item.ocr_unit_price,
        item.ocr_amount,
        item.product_name,
        item.specification,
        item.quantity,
        item.unit_price,
        item.amount,
        item.matched_product_code,
        item.matched_product_name,
        item.match_method.value if item.match_method else None,
        item.match_score,
        product.base_stock if product else item.base_stock,
        item.stock_increment,
        product.final_stock if product else None,
        product.base_purchase_price if product else item.base_purchase_price,
        product.final_purchase_price if product else item.base_purchase_price,
        item.apply_inventory,
        item.apply_purchase_price,
        _json(item.warnings),
        item.notes,
        approved_by,
        approved_at,
    )


def _excluded_history_row(
    job: Job, item: Item, approved_by: str, approved_at: str
) -> tuple:
    document = item.document
    last_candidate = item.match_candidates[0] if item.match_candidates else None
    return (
        job.id,
        job.original_excel_sha256,
        document.id,
        document.original_image_name,
        document.image_sha256,
        (
            document.transaction_date.isoformat()
            if document.transaction_date is not None
            else None
        ),
        item.id,
        item.raw_row_text,
        item.ocr_product_name,
        item.ocr_specification,
        item.ocr_quantity,
        item.ocr_unit_price,
        item.ocr_amount,
        item.product_name,
        item.specification,
        item.quantity,
        item.unit_price,
        item.amount,
        _json(last_candidate),
        item.exclusion_reason,
        _json(item.warnings),
        item.notes,
        approved_by,
        approved_at,
    )


def _json(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def _commit_export_success(db: Session) -> None:
    db.commit()


def _rollback_export(
    db: Session,
    job_id: str,
    destination_path: Path | None,
    attempt_id: str,
) -> None:
    released = db.execute(
        update(Job)
        .where(
            Job.id == job_id,
            Job.status == JobStatus.EXPORTING,
            Job.export_attempt_id == attempt_id,
        )
        .values(
            status=case(
                (
                    Job.original_excel_path.is_not(None),
                    JobStatus.REVIEWING,
                ),
                else_=JobStatus.DRAFT,
            ),
            result_path=None,
            approved_by=None,
            completed_at=None,
            export_attempt_id=None,
            updated_at=utc_now(),
        )
    )
    if released.rowcount != 1:
        db.rollback()
        return
    db.execute(
        delete(CompletedDocument).where(CompletedDocument.job_id == job_id)
    )
    db.commit()
    if destination_path is not None:
        destination_path.unlink(missing_ok=True)
