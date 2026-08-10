from __future__ import annotations

from datetime import date
from typing import List, Literal, Optional

from pydantic import BaseModel, Field, model_validator


class ReviewBlocker(BaseModel):
    code: str
    message: str
    item_ids: List[str] = Field(default_factory=list)
    document_ids: List[str] = Field(default_factory=list)


class ReviewCounts(BaseModel):
    approved_items: int
    excluded_items: int
    pending_items: int
    inventory_products: int
    price_products: int


class PriceCandidateRead(BaseModel):
    item_id: str
    document_id: str
    document_name: str
    transaction_date: Optional[date]
    unit_price: int
    quantity: Optional[int]
    selected: bool


class ProductReviewRead(BaseModel):
    product_code: str
    product_name: Optional[str]
    base_stock: Optional[int]
    stock_increment: int
    final_stock: Optional[int]
    base_purchase_price: Optional[int]
    final_purchase_price: Optional[int]
    item_ids: List[str]
    price_resolution_method: Optional[
        Literal["unresolved", "automatic", "manual"]
    ]
    price_candidates: List[PriceCandidateRead]


class ReviewSummaryRead(BaseModel):
    job_id: str
    ready_to_export: bool
    blockers: List[ReviewBlocker]
    counts: ReviewCounts
    products: List[ProductReviewRead]


class PriceResolutionRequest(BaseModel):
    selected_item_id: str = Field(min_length=1, max_length=36)

    @model_validator(mode="after")
    def normalize_selected_item_id(self) -> "PriceResolutionRequest":
        self.selected_item_id = self.selected_item_id.strip()
        if not self.selected_item_id:
            raise ValueError("대표 단가 품목을 선택해 주세요.")
        return self


class ExportRequest(BaseModel):
    approved_by: str = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def normalize_approved_by(self) -> "ExportRequest":
        self.approved_by = self.approved_by.strip()
        if not self.approved_by:
            raise ValueError("승인자 이름을 입력해 주세요.")
        return self
