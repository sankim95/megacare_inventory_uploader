from __future__ import annotations

from datetime import date, datetime
from typing import TYPE_CHECKING, Any, Dict, List, Optional

from sqlalchemy import Boolean, CheckConstraint, Date, DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.enums import DocumentStatus, DuplicateStatus
from app.models.job import new_id, utc_now
from app.models.types import enum_type

if TYPE_CHECKING:
    from app.models.completed_document import CompletedDocument
    from app.models.item import Item
    from app.models.job import Job


class Document(Base):
    __tablename__ = "documents"
    __table_args__ = (
        UniqueConstraint("job_id", "source_order", name="uq_documents_job_source_order"),
        CheckConstraint(
            "status IN ('pending', 'processing', 'completed', 'failed')",
            name="document_status",
        ),
        CheckConstraint(
            "duplicate_status IN ('none', 'suspected', 'confirmed')",
            name="duplicate_status",
        ),
        CheckConstraint("source_order >= 0", name="source_order_nonnegative"),
        CheckConstraint(
            "document_total IS NULL OR document_total >= 0",
            name="document_total_nonnegative",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    job_id: Mapped[str] = mapped_column(
        ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    source_order: Mapped[int] = mapped_column(Integer, nullable=False)
    original_image_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    original_image_name: Mapped[str] = mapped_column(String(255), nullable=False)
    corrected_image_path: Mapped[Optional[str]] = mapped_column(String(1024))
    correction_applied: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("0")
    )
    correction_warning: Mapped[Optional[str]] = mapped_column(String(1000))
    image_sha256: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    status: Mapped[DocumentStatus] = mapped_column(
        enum_type(DocumentStatus, "document_status"),
        nullable=False,
        default=DocumentStatus.PENDING,
        server_default=DocumentStatus.PENDING.value,
        index=True,
    )
    photo_supplier: Mapped[Optional[str]] = mapped_column(String(255))
    transaction_date: Mapped[Optional[date]] = mapped_column(Date)
    invoice_number: Mapped[Optional[str]] = mapped_column(String(100))
    document_total: Mapped[Optional[int]] = mapped_column(Integer)
    raw_header_text: Mapped[Optional[str]] = mapped_column(Text)
    confidence_by_field: Mapped[Dict[str, Any]] = mapped_column(
        JSON, nullable=False, default=dict
    )
    model_response: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON)
    model_name: Mapped[Optional[str]] = mapped_column(String(100))
    prompt_version: Mapped[Optional[str]] = mapped_column(String(50))
    duplicate_status: Mapped[DuplicateStatus] = mapped_column(
        enum_type(DuplicateStatus, "duplicate_status"),
        nullable=False,
        default=DuplicateStatus.NONE,
        server_default=DuplicateStatus.NONE.value,
        index=True,
    )
    document_identity_key: Mapped[Optional[str]] = mapped_column(String(512), index=True)
    item_signature: Mapped[Optional[str]] = mapped_column(String(64), index=True)
    processing_error: Mapped[Optional[str]] = mapped_column(String(1000))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now
    )

    job: Mapped["Job"] = relationship(back_populates="documents")
    items: Mapped[List["Item"]] = relationship(
        back_populates="document", cascade="all, delete-orphan"
    )
    completed_record: Mapped[Optional["CompletedDocument"]] = relationship(
        back_populates="source_document", uselist=False
    )
