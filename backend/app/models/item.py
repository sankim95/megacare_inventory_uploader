from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Any, Dict, List, Optional

from sqlalchemy import Boolean, CheckConstraint, DateTime, Float, ForeignKey, Integer, JSON, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.enums import MatchMethod, ReviewStatus
from app.models.job import new_id, utc_now
from app.models.types import enum_type

if TYPE_CHECKING:
    from app.models.document import Document
    from app.models.price_resolution import PriceResolution


class Item(Base):
    __tablename__ = "items"
    __table_args__ = (
        CheckConstraint(
            "match_method IS NULL OR match_method IN ('code', 'normalized_name_spec', 'similarity', 'manual')",
            name="match_method",
        ),
        CheckConstraint(
            "review_status IN ('pending', 'approved', 'excluded')",
            name="review_status",
        ),
        CheckConstraint("source_row_order >= 0", name="source_row_order_nonnegative"),
        CheckConstraint("quantity IS NULL OR quantity >= 0", name="quantity_nonnegative"),
        CheckConstraint("unit_price IS NULL OR unit_price >= 0", name="unit_price_nonnegative"),
        CheckConstraint("amount IS NULL OR amount >= 0", name="amount_nonnegative"),
        CheckConstraint(
            "stock_increment IS NULL OR stock_increment >= 0",
            name="stock_increment_nonnegative",
        ),
        CheckConstraint(
            "base_purchase_price IS NULL OR base_purchase_price >= 0",
            name="base_purchase_price_nonnegative",
        ),
        CheckConstraint(
            "review_status != 'approved' OR "
            "(matched_product_code IS NOT NULL AND stock_increment IS NOT NULL)",
            name="approved_requires_match_and_stock",
        ),
        CheckConstraint(
            "review_status != 'excluded' OR "
            "(exclusion_reason IS NOT NULL AND length(trim(exclusion_reason)) > 0)",
            name="excluded_requires_reason",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    document_id: Mapped[str] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    source_row_order: Mapped[int] = mapped_column(Integer, nullable=False)
    is_manual: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("0")
    )

    raw_row_text: Mapped[Optional[str]] = mapped_column(Text)
    ocr_product_code_or_barcode: Mapped[Optional[str]] = mapped_column(String(100))
    ocr_product_name: Mapped[Optional[str]] = mapped_column(String(255))
    ocr_specification: Mapped[Optional[str]] = mapped_column(String(255))
    ocr_quantity: Mapped[Optional[int]] = mapped_column(Integer)
    ocr_unit_price: Mapped[Optional[int]] = mapped_column(Integer)
    ocr_amount: Mapped[Optional[int]] = mapped_column(Integer)
    ocr_bundle_or_set_text: Mapped[Optional[str]] = mapped_column(String(255))
    ocr_confidence_by_field: Mapped[Dict[str, Any]] = mapped_column(
        JSON, nullable=False, default=dict
    )
    extraction_warnings: Mapped[List[Any]] = mapped_column(JSON, nullable=False, default=list)
    confidence: Mapped[Optional[float]] = mapped_column(Float)

    product_code_or_barcode: Mapped[Optional[str]] = mapped_column(String(100))
    product_name: Mapped[Optional[str]] = mapped_column(String(255))
    specification: Mapped[Optional[str]] = mapped_column(String(255))
    quantity: Mapped[Optional[int]] = mapped_column(Integer)
    unit_price: Mapped[Optional[int]] = mapped_column(Integer)
    amount: Mapped[Optional[int]] = mapped_column(Integer)
    bundle_or_set_text: Mapped[Optional[str]] = mapped_column(String(255))
    stock_increment: Mapped[Optional[int]] = mapped_column(Integer)

    matched_product_code: Mapped[Optional[str]] = mapped_column(String(100), index=True)
    matched_product_name: Mapped[Optional[str]] = mapped_column(String(255))
    matched_specification: Mapped[Optional[str]] = mapped_column(String(255))
    matched_supplier_code: Mapped[Optional[str]] = mapped_column(String(100))
    matched_supplier: Mapped[Optional[str]] = mapped_column(String(255))
    matched_excel_row: Mapped[Optional[int]] = mapped_column(Integer)
    match_method: Mapped[Optional[MatchMethod]] = mapped_column(
        enum_type(MatchMethod, "match_method")
    )
    match_score: Mapped[Optional[float]] = mapped_column(Float)
    match_candidates: Mapped[List[Any]] = mapped_column(JSON, nullable=False, default=list)
    base_stock: Mapped[Optional[int]] = mapped_column(Integer)
    base_purchase_price: Mapped[Optional[int]] = mapped_column(Integer)

    apply_inventory: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("1")
    )
    apply_purchase_price: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("0")
    )
    review_status: Mapped[ReviewStatus] = mapped_column(
        enum_type(ReviewStatus, "review_status"),
        nullable=False,
        default=ReviewStatus.PENDING,
        server_default=ReviewStatus.PENDING.value,
        index=True,
    )
    exclusion_reason: Mapped[Optional[str]] = mapped_column(String(500))
    warnings: Mapped[List[Any]] = mapped_column(JSON, nullable=False, default=list)
    notes: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now
    )

    document: Mapped["Document"] = relationship(back_populates="items")
    selected_for_price_resolution: Mapped[Optional["PriceResolution"]] = relationship(
        back_populates="selected_item", uselist=False
    )
