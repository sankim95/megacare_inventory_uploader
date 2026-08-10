from __future__ import annotations

import base64
from pathlib import Path
from typing import Any, List, Optional
from uuid import uuid4

from PIL import Image
from pydantic import SecretStr, ValidationError
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models import (
    Document,
    DocumentStatus,
    DuplicateStatus,
    Item,
    Job,
    JobStatus,
    ProductIndex,
)
from app.models.job import utc_now
from app.schemas.documents import DocumentRead
from app.schemas.extraction import ExtractedItem, InvoiceExtraction
from app.services.documents import to_document_read
from app.services.images import correct_document_image


PROMPT_VERSION = "invoice-extraction-v1"
EXTRACTION_PROMPT = """
이 이미지는 한국 의약품 거래명세서입니다. 문서 머리말과 모든 품목 행을 빠짐없이 추출하세요.
숫자는 통화 기호와 천 단위 구분자를 제거한 정수로 반환하세요. 날짜는 YYYY-MM-DD 형식으로 반환하세요.
이미지에서 확인되지 않는 값은 추측하지 말고 null로 반환하세요. source_row_order는 위에서 아래 순서대로 0부터 부여하세요.
confidence_by_field에는 확인 가능한 각 필드의 0~1 신뢰도를 넣고, 애매하거나 잘린 값은 extraction_warnings에 한국어로 설명하세요.
""".strip()


class ExtractionOperationError(ValueError):
    pass


class AIExtractionError(RuntimeError):
    pass


def extract_job_documents(
    db: Session, job: Job, settings: Settings
) -> List[DocumentRead]:
    _validate_extractable_job(db, job)
    documents = db.scalars(
        select(Document)
        .where(Document.job_id == job.id)
        .order_by(Document.source_order)
    ).all()
    if not documents:
        raise ExtractionOperationError("추출할 거래명세서 이미지가 없습니다.")

    attempt_id = _acquire_extraction(db, job.id)
    documents = db.scalars(
        select(Document)
        .where(Document.job_id == job.id)
        .order_by(Document.source_order)
    ).all()

    results: List[DocumentRead] = []
    try:
        for document in documents:
            if document.status not in {DocumentStatus.PENDING, DocumentStatus.FAILED}:
                results.append(to_document_read(document))
                continue
            if document.duplicate_status == DuplicateStatus.CONFIRMED:
                results.append(to_document_read(document))
                continue
            if Path(document.original_image_path).suffix == ".invalid":
                results.append(to_document_read(document))
                continue
            results.append(
                extract_document(db, document.id, settings, attempt_id=attempt_id)
            )
        return results
    finally:
        _finish_extraction(db, job.id, attempt_id)


def retry_document_extraction(
    db: Session, document: Document, settings: Settings
) -> DocumentRead:
    _validate_extractable_job(db, document.job)
    if document.status not in {DocumentStatus.PENDING, DocumentStatus.FAILED}:
        raise ExtractionOperationError(
            "대기 또는 실패 상태의 거래명세서만 다시 추출할 수 있습니다."
        )
    if document.duplicate_status == DuplicateStatus.CONFIRMED:
        raise ExtractionOperationError(
            "확정 중복 거래명세서는 다시 추출할 수 없습니다."
        )
    if Path(document.original_image_path).suffix == ".invalid":
        raise ExtractionOperationError(
            "해석할 수 없는 이미지입니다. 올바른 파일을 다시 업로드해 주세요."
        )
    job_id = document.job_id
    document_id = document.id
    attempt_id = _acquire_extraction(db, job_id)
    try:
        current = db.get(Document, document_id)
        if current is None:
            raise ExtractionOperationError("거래명세서를 찾을 수 없습니다.")
        if current.status not in {DocumentStatus.PENDING, DocumentStatus.FAILED}:
            raise ExtractionOperationError(
                "대기 또는 실패 상태의 거래명세서만 다시 추출할 수 있습니다."
            )
        return extract_document(
            db, document_id, settings, attempt_id=attempt_id
        )
    finally:
        _finish_extraction(db, job_id, attempt_id)


def extract_document(
    db: Session,
    document_id: str,
    settings: Settings,
    *,
    attempt_id: str,
) -> DocumentRead:
    _assert_extraction_owner(db, document_id, attempt_id)
    document = db.get(Document, document_id)
    if document is None:
        raise ExtractionOperationError("거래명세서를 찾을 수 없습니다.")

    document.status = DocumentStatus.PROCESSING
    document.processing_error = None
    document.model_name = settings.openai_model
    document.prompt_version = PROMPT_VERSION
    document.updated_at = utc_now()
    db.commit()

    try:
        api_key = _api_key_value(settings.openai_api_key)
        if not api_key:
            raise AIExtractionError(
                "OPENAI_API_KEY가 설정되지 않아 추출할 수 없습니다."
            )

        document = db.get(Document, document_id)
        if document is None:
            raise ExtractionOperationError("거래명세서를 찾을 수 없습니다.")
        image_path = _ensure_corrected_image(document, settings, db)
        parsed = parse_invoice_image(
            image_path=image_path,
            api_key=api_key,
            model=settings.openai_model,
        )
        _assert_extraction_owner(db, document_id, attempt_id)
        document = db.get(Document, document_id)
        if document is None:
            raise ExtractionOperationError("거래명세서를 찾을 수 없습니다.")
        _store_extraction(db, document, parsed)
        db.commit()
        db.refresh(document)
        return to_document_read(document)
    except Exception as exc:
        db.rollback()
        if not _owns_extraction(db, document_id, attempt_id):
            raise ExtractionOperationError(
                "추출 실행 권한이 변경되어 이전 실행 결과를 저장하지 않았습니다."
            ) from exc
        failed = db.get(Document, document_id)
        if failed is None:
            raise
        failed.status = DocumentStatus.FAILED
        failed.processing_error = _public_extraction_error(exc)
        failed.updated_at = utc_now()
        db.commit()
        db.refresh(failed)
        return to_document_read(failed)


def parse_invoice_image(
    image_path: Path,
    api_key: str,
    model: str,
    client: Optional[Any] = None,
) -> InvoiceExtraction:
    if client is None:
        from openai import OpenAI

        client = OpenAI(api_key=api_key, max_retries=0)

    image_bytes = image_path.read_bytes()
    mime_type = _image_mime_type(image_path)
    image_url = f"data:{mime_type};base64,{base64.b64encode(image_bytes).decode('ascii')}"
    last_error: Optional[Exception] = None

    for _ in range(2):
        try:
            response = client.responses.parse(
                model=model,
                input=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "input_text", "text": EXTRACTION_PROMPT},
                            {
                                "type": "input_image",
                                "image_url": image_url,
                                "detail": "original",
                            },
                        ],
                    }
                ],
                text_format=InvoiceExtraction,
            )
            if _has_refusal(response):
                raise AIExtractionError("AI가 이미지 처리를 거부했습니다.")
            parsed = getattr(response, "output_parsed", None)
            if parsed is None:
                raise AIExtractionError("AI 구조화 응답이 비어 있습니다.")
            if not isinstance(parsed, InvoiceExtraction):
                parsed = InvoiceExtraction.model_validate(parsed)
            return parsed
        except Exception as exc:
            last_error = exc

    raise AIExtractionError("AI 구조화 추출에 실패했습니다.") from last_error


def _validate_extractable_job(db: Session, job: Job) -> None:
    if not job.original_excel_path:
        raise ExtractionOperationError("먼저 상품리스트 Excel 파일을 업로드해 주세요.")
    product_count = db.scalar(
        select(ProductIndex.id).where(ProductIndex.job_id == job.id).limit(1)
    )
    if product_count is None:
        raise ExtractionOperationError("상품리스트 색인이 비어 있어 추출할 수 없습니다.")


def _acquire_extraction(db: Session, job_id: str) -> str:
    attempt_id = str(uuid4())
    acquired = db.execute(
        update(Job)
        .where(
            Job.id == job_id,
            Job.status.not_in(
                (JobStatus.EXTRACTING, JobStatus.EXPORTING, JobStatus.COMPLETED)
            ),
        )
        .values(
            status=JobStatus.EXTRACTING,
            extraction_attempt_id=attempt_id,
            failure_message=None,
            updated_at=utc_now(),
        )
        .execution_options(synchronize_session=False)
    )
    if acquired.rowcount != 1:
        db.rollback()
        raise ExtractionOperationError(
            "이미 추출·내보내기 중이거나 완료된 작업은 다시 추출할 수 없습니다."
        )
    db.commit()
    db.expire_all()
    return attempt_id


def _finish_extraction(db: Session, job_id: str, attempt_id: str) -> None:
    db.rollback()
    db.execute(
        update(Job)
        .where(
            Job.id == job_id,
            Job.status == JobStatus.EXTRACTING,
            Job.extraction_attempt_id == attempt_id,
        )
        .values(
            status=JobStatus.REVIEWING,
            extraction_attempt_id=None,
            updated_at=utc_now(),
        )
        .execution_options(synchronize_session=False)
    )
    db.commit()
    db.expire_all()


def _owns_extraction(db: Session, document_id: str, attempt_id: str) -> bool:
    job_id = select(Document.job_id).where(Document.id == document_id).scalar_subquery()
    owner = db.execute(
        update(Job)
        .where(
            Job.id == job_id,
            Job.status == JobStatus.EXTRACTING,
            Job.extraction_attempt_id == attempt_id,
        )
        .values(updated_at=Job.updated_at)
        .execution_options(synchronize_session=False)
    )
    return owner.rowcount == 1


def _assert_extraction_owner(
    db: Session, document_id: str, attempt_id: str
) -> None:
    if not _owns_extraction(db, document_id, attempt_id):
        raise ExtractionOperationError(
            "추출 실행 권한이 변경되어 이전 실행 결과를 저장할 수 없습니다."
        )


def _ensure_corrected_image(
    document: Document, settings: Settings, db: Session
) -> Path:
    if document.corrected_image_path:
        corrected_path = Path(document.corrected_image_path)
        if corrected_path.is_file():
            return corrected_path

    original_path = Path(document.original_image_path)
    if not original_path.is_file():
        raise AIExtractionError("원본 이미지 파일을 찾을 수 없습니다.")
    correction = correct_document_image(
        original_path, settings.data_dir / "corrected"
    )
    document.corrected_image_path = (
        str(correction.path) if correction.path is not None else None
    )
    document.correction_applied = correction.applied
    document.correction_warning = correction.warning
    document.updated_at = utc_now()
    db.commit()
    return correction.path or original_path


def _store_extraction(
    db: Session, document: Document, parsed: InvoiceExtraction
) -> None:
    extracted_document = parsed.document
    manual_items = db.scalars(
        select(Item)
        .where(
            Item.document_id == document.id,
            Item.is_manual.is_(True),
        )
        .order_by(Item.source_row_order, Item.created_at, Item.id)
    ).all()
    db.execute(
        delete(Item).where(
            Item.document_id == document.id,
            Item.is_manual.is_(False),
        )
    )
    document.photo_supplier = extracted_document.photo_supplier
    document.transaction_date = extracted_document.transaction_date
    document.invoice_number = extracted_document.invoice_number
    document.document_total = extracted_document.document_total
    document.raw_header_text = extracted_document.raw_header_text
    document.confidence_by_field = extracted_document.confidence_by_field.model_dump()
    document.model_response = parsed.model_dump(mode="json")

    for extracted_item in parsed.items:
        db.add(_new_item(document.id, extracted_item))

    next_manual_order = max(
        (item.source_row_order for item in parsed.items),
        default=-1,
    ) + 1
    for offset, manual_item in enumerate(manual_items):
        manual_item.source_row_order = next_manual_order + offset

    db.flush()
    items = db.scalars(
        select(Item)
        .where(Item.document_id == document.id)
        .order_by(Item.source_row_order)
    ).all()
    from app.services.duplicates import recalculate_job_duplicates
    from app.services.matching import recalculate_item_match
    from app.services.review import recalculate_document_warnings

    products = db.scalars(
        select(ProductIndex)
        .where(ProductIndex.job_id == document.job_id)
        .order_by(ProductIndex.excel_row)
    ).all()
    for item in items:
        recalculate_item_match(db, item, products, auto_approve=not item.is_manual)
    recalculate_document_warnings(document)
    recalculate_job_duplicates(db, document.job_id)

    document.status = DocumentStatus.COMPLETED
    document.processing_error = None
    document.updated_at = utc_now()


def _new_item(document_id: str, extracted: ExtractedItem) -> Item:
    confidence_values = [
        float(value)
        for value in extracted.confidence_by_field.model_dump().values()
        if value is not None and 0 <= value <= 1
    ]
    confidence = min(confidence_values) if confidence_values else None
    return Item(
        document_id=document_id,
        source_row_order=extracted.source_row_order,
        is_manual=False,
        raw_row_text=extracted.raw_row_text,
        ocr_product_code_or_barcode=extracted.product_code_or_barcode,
        ocr_product_name=extracted.product_name,
        ocr_specification=extracted.specification,
        ocr_quantity=extracted.quantity,
        ocr_unit_price=extracted.unit_price,
        ocr_amount=extracted.amount,
        ocr_bundle_or_set_text=extracted.bundle_or_set_text,
        ocr_confidence_by_field=extracted.confidence_by_field.model_dump(),
        extraction_warnings=extracted.extraction_warnings,
        confidence=confidence,
        product_code_or_barcode=extracted.product_code_or_barcode,
        product_name=extracted.product_name,
        specification=extracted.specification,
        quantity=extracted.quantity,
        unit_price=extracted.unit_price,
        amount=extracted.amount,
        bundle_or_set_text=extracted.bundle_or_set_text,
        stock_increment=extracted.quantity,
        apply_inventory=True,
    )


def _image_mime_type(path: Path) -> str:
    try:
        with Image.open(path) as image:
            image_format = image.format
    except Exception as exc:
        raise AIExtractionError("이미지 파일을 해석할 수 없습니다.") from exc
    mime_types = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}
    try:
        return mime_types[image_format]
    except KeyError as exc:
        raise AIExtractionError("지원하지 않는 이미지 형식입니다.") from exc


def _has_refusal(response: Any) -> bool:
    for output in getattr(response, "output", []) or []:
        for content in getattr(output, "content", []) or []:
            content_type = getattr(content, "type", None)
            refusal = getattr(content, "refusal", None)
            if content_type == "refusal" or refusal:
                return True
    return False


def _api_key_value(value: Optional[SecretStr]) -> str:
    if value is None:
        return ""
    return value.get_secret_value().strip()


def _public_extraction_error(exc: Exception) -> str:
    if isinstance(exc, AIExtractionError) and str(exc).startswith("OPENAI_API_KEY"):
        return str(exc)
    if isinstance(exc, ExtractionOperationError):
        return str(exc)
    if isinstance(exc, ValidationError):
        return "AI 구조화 응답 형식이 올바르지 않습니다. 다시 시도해 주세요."
    return "AI 추출에 실패했습니다. 다시 시도해 주세요."
