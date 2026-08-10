from __future__ import annotations

from datetime import date
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.enums import (
    DocumentStatus,
    DuplicateStatus,
    MatchMethod,
    ReviewStatus,
)
from app.schemas.common import UtcDateTime


class ProductCandidate(BaseModel):
    product_code: str
    product_name: Optional[str]
    specification: Optional[str]
    supplier_code: Optional[str]
    supplier: Optional[str]
    current_stock: Optional[int]
    purchase_price: Optional[int]
    excel_row: int
    match_method: MatchMethod
    score: float = Field(ge=0, le=1)
    price_similarity: Optional[float] = Field(default=None, ge=0, le=1)


class StructuredWarning(BaseModel):
    code: str = Field(min_length=1)
    message: str = Field(min_length=1)
    evidence: Dict[str, Any]


class ItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    document_id: str
    source_row_order: int
    is_manual: bool
    raw_row_text: Optional[str]
    ocr_product_code_or_barcode: Optional[str]
    ocr_product_name: Optional[str]
    ocr_specification: Optional[str]
    ocr_quantity: Optional[int]
    ocr_unit_price: Optional[int]
    ocr_amount: Optional[int]
    ocr_bundle_or_set_text: Optional[str]
    ocr_confidence_by_field: Dict[str, Any]
    extraction_warnings: List[Any]
    product_code_or_barcode: Optional[str]
    product_name: Optional[str]
    specification: Optional[str]
    quantity: Optional[int]
    unit_price: Optional[int]
    amount: Optional[int]
    bundle_or_set_text: Optional[str]
    stock_increment: Optional[int]
    matched_product_code: Optional[str]
    matched_product_name: Optional[str]
    matched_specification: Optional[str]
    matched_supplier_code: Optional[str]
    matched_supplier: Optional[str]
    matched_excel_row: Optional[int]
    match_method: Optional[MatchMethod]
    match_score: Optional[float]
    match_candidates: List[ProductCandidate]
    base_stock: Optional[int]
    base_purchase_price: Optional[int]
    apply_inventory: bool
    apply_purchase_price: bool
    review_status: ReviewStatus
    exclusion_reason: Optional[str]
    warnings: List[StructuredWarning]
    notes: Optional[str]
    created_at: UtcDateTime
    updated_at: UtcDateTime


class DocumentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    job_id: str
    source_order: int
    original_image_name: str
    status: DocumentStatus
    duplicate_status: DuplicateStatus
    image_sha256: str
    has_corrected_image: bool
    correction_applied: bool
    correction_warning: Optional[str]
    photo_supplier: Optional[str]
    transaction_date: Optional[date]
    invoice_number: Optional[str]
    document_total: Optional[int]
    processing_error: Optional[str]
    model_name: Optional[str]
    prompt_version: Optional[str]
    created_at: UtcDateTime
    updated_at: UtcDateTime


class DocumentDetailRead(DocumentRead):
    raw_header_text: Optional[str]
    confidence_by_field: Dict[str, Any]
    items: List[ItemRead]


class DocumentUpdate(BaseModel):
    photo_supplier: Optional[str] = Field(default=None, max_length=255)
    transaction_date: Optional[date] = None
    invoice_number: Optional[str] = Field(default=None, max_length=100)
    document_total: Optional[int] = Field(default=None, ge=0)

    @model_validator(mode="after")
    def validate_and_normalize(self) -> "DocumentUpdate":
        if not self.model_fields_set:
            raise ValueError("수정할 문서 정보를 하나 이상 입력해 주세요.")
        for name in ("photo_supplier", "invoice_number"):
            if name in self.model_fields_set:
                value = getattr(self, name)
                if value is not None:
                    setattr(self, name, value.strip() or None)
        return self


class ItemCurrentValues(BaseModel):
    product_code_or_barcode: Optional[str] = Field(default=None, max_length=100)
    product_name: Optional[str] = Field(default=None, max_length=255)
    specification: Optional[str] = Field(default=None, max_length=255)
    quantity: Optional[int] = Field(default=None, ge=0)
    unit_price: Optional[int] = Field(default=None, ge=0)
    amount: Optional[int] = Field(default=None, ge=0)
    bundle_or_set_text: Optional[str] = Field(default=None, max_length=255)
    stock_increment: Optional[int] = Field(default=None, ge=0)
    apply_inventory: bool = True

    @model_validator(mode="after")
    def normalize_text(self) -> "ItemCurrentValues":
        for name in (
            "product_code_or_barcode",
            "product_name",
            "specification",
            "bundle_or_set_text",
        ):
            value = getattr(self, name)
            if value is not None:
                setattr(self, name, value.strip() or None)
        return self


class ManualItemCreate(ItemCurrentValues):
    pass


class ItemUpdate(BaseModel):
    product_code_or_barcode: Optional[str] = Field(default=None, max_length=100)
    product_name: Optional[str] = Field(default=None, max_length=255)
    specification: Optional[str] = Field(default=None, max_length=255)
    quantity: Optional[int] = Field(default=None, ge=0)
    unit_price: Optional[int] = Field(default=None, ge=0)
    amount: Optional[int] = Field(default=None, ge=0)
    bundle_or_set_text: Optional[str] = Field(default=None, max_length=255)
    stock_increment: Optional[int] = Field(default=None, ge=0)
    apply_inventory: bool = True
    apply_purchase_price: bool = False
    review_status: ReviewStatus = ReviewStatus.PENDING
    exclusion_reason: Optional[str] = Field(default=None, max_length=500)
    notes: Optional[str] = Field(default=None, max_length=5000)

    @model_validator(mode="after")
    def validate_and_normalize(self) -> "ItemUpdate":
        if not self.model_fields_set:
            raise ValueError("수정할 항목을 하나 이상 입력해 주세요.")
        for name in (
            "product_code_or_barcode",
            "product_name",
            "specification",
            "bundle_or_set_text",
            "exclusion_reason",
            "notes",
        ):
            if name in self.model_fields_set:
                value = getattr(self, name)
                if value is not None:
                    setattr(self, name, value.strip() or None)
        return self


class BulkItemUpdate(BaseModel):
    item_ids: Optional[List[str]] = Field(default=None, min_length=1)
    target_review_status: Optional[ReviewStatus] = None
    review_status: Optional[ReviewStatus] = None
    apply_inventory: Optional[bool] = None
    apply_purchase_price: Optional[bool] = None
    exclusion_reason: Optional[str] = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def validate_selector_and_changes(self) -> "BulkItemUpdate":
        selectors = int(self.item_ids is not None) + int(
            self.target_review_status is not None
        )
        if selectors != 1:
            raise ValueError(
                "item_ids 또는 target_review_status 중 하나만 입력해 주세요."
            )

        change_fields = {
            "review_status",
            "apply_inventory",
            "apply_purchase_price",
            "exclusion_reason",
        }
        if not self.model_fields_set.intersection(change_fields):
            raise ValueError("변경할 검수 항목을 하나 이상 입력해 주세요.")
        for field in change_fields - {"exclusion_reason"}:
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} 값은 null일 수 없습니다.")

        if self.item_ids is not None:
            normalized_ids = [item_id.strip() for item_id in self.item_ids]
            if any(not item_id for item_id in normalized_ids):
                raise ValueError("빈 품목 ID는 사용할 수 없습니다.")
            if len(set(normalized_ids)) != len(normalized_ids):
                raise ValueError("중복된 품목 ID가 있습니다.")
            self.item_ids = normalized_ids
        if "exclusion_reason" in self.model_fields_set and self.exclusion_reason is not None:
            self.exclusion_reason = self.exclusion_reason.strip() or None
        return self

    def changes(self) -> Dict[str, Any]:
        change_fields = {
            "review_status",
            "apply_inventory",
            "apply_purchase_price",
            "exclusion_reason",
        }
        return {
            field: getattr(self, field)
            for field in change_fields
            if field in self.model_fields_set
        }


class ManualMatchRequest(BaseModel):
    product_code: str = Field(min_length=1, max_length=255)
    approve: bool = False

    @model_validator(mode="after")
    def normalize_product_code(self) -> "ManualMatchRequest":
        self.product_code = self.product_code.strip()
        if not self.product_code:
            raise ValueError("상품코드를 입력해 주세요.")
        return self


class RegisterProductRequest(BaseModel):
    product_code: str = Field(min_length=1, max_length=255)
    product_name: str = Field(min_length=1, max_length=500)
    specification: Optional[str] = Field(default=None, max_length=500)
    current_stock: int = Field(default=0, ge=0)
    purchase_price: Optional[int] = Field(default=None, ge=0)
    supplier_code: Optional[str] = Field(default=None, max_length=255)
    supplier: Optional[str] = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def normalize_text_fields(self) -> "RegisterProductRequest":
        self.product_code = self.product_code.strip()
        self.product_name = self.product_name.strip()
        if not self.product_code:
            raise ValueError("상품코드를 입력해 주세요.")
        if not self.product_name:
            raise ValueError("상품명을 입력해 주세요.")
        for name in ("specification", "supplier_code", "supplier"):
            value = getattr(self, name)
            if value is not None:
                setattr(self, name, value.strip() or None)
        return self
