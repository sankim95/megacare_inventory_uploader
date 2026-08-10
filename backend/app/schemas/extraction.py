from __future__ import annotations

from datetime import date
from typing import Annotated, List, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictExtractionSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")


Confidence = Annotated[float, Field(ge=0, le=1)]


class DocumentConfidence(StrictExtractionSchema):
    photo_supplier: Optional[Confidence]
    transaction_date: Optional[Confidence]
    invoice_number: Optional[Confidence]
    document_total: Optional[Confidence]
    raw_header_text: Optional[Confidence]


class ItemConfidence(StrictExtractionSchema):
    raw_row_text: Optional[Confidence]
    product_code_or_barcode: Optional[Confidence]
    product_name: Optional[Confidence]
    specification: Optional[Confidence]
    quantity: Optional[Confidence]
    unit_price: Optional[Confidence]
    amount: Optional[Confidence]
    bundle_or_set_text: Optional[Confidence]


class ExtractedDocument(StrictExtractionSchema):
    photo_supplier: Optional[str]
    transaction_date: Optional[date]
    invoice_number: Optional[str]
    document_total: Optional[int] = Field(ge=0)
    raw_header_text: Optional[str]
    confidence_by_field: DocumentConfidence


class ExtractedItem(StrictExtractionSchema):
    source_row_order: int = Field(ge=0)
    raw_row_text: Optional[str]
    product_code_or_barcode: Optional[str]
    product_name: Optional[str]
    specification: Optional[str]
    quantity: Optional[int] = Field(ge=0)
    unit_price: Optional[int] = Field(ge=0)
    amount: Optional[int] = Field(ge=0)
    bundle_or_set_text: Optional[str]
    confidence_by_field: ItemConfidence
    extraction_warnings: List[str]


class InvoiceExtraction(StrictExtractionSchema):
    document: ExtractedDocument
    items: List[ExtractedItem] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_item_order(self) -> "InvoiceExtraction":
        orders = [item.source_row_order for item in self.items]
        if len(set(orders)) != len(orders):
            raise ValueError("품목 행 순서가 중복되었습니다.")
        if orders != sorted(orders):
            raise ValueError("품목 행 순서가 원문 순서와 다릅니다.")
        return self
