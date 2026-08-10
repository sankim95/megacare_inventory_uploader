from __future__ import annotations

from datetime import datetime, timezone
from typing import TYPE_CHECKING, List, Optional
from uuid import uuid4

from sqlalchemy import CheckConstraint, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.enums import JobStatus
from app.models.types import enum_type

if TYPE_CHECKING:
    from app.models.completed_document import CompletedDocument
    from app.models.document import Document
    from app.models.price_resolution import PriceResolution
    from app.models.product_index import ProductIndex


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def new_id() -> str:
    return str(uuid4())


class Job(Base):
    __tablename__ = "jobs"
    __table_args__ = (
        CheckConstraint(
            "status IN ('draft', 'extracting', 'reviewing', 'exporting', 'completed', 'failed')",
            name="job_status",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    status: Mapped[JobStatus] = mapped_column(
        enum_type(JobStatus, "job_status"),
        nullable=False,
        default=JobStatus.DRAFT,
        server_default=JobStatus.DRAFT.value,
        index=True,
    )
    original_excel_path: Mapped[Optional[str]] = mapped_column(String(1024))
    original_excel_name: Mapped[Optional[str]] = mapped_column(String(255))
    original_excel_sha256: Mapped[Optional[str]] = mapped_column(String(64), index=True)
    approved_by: Mapped[Optional[str]] = mapped_column(String(100))
    result_path: Mapped[Optional[str]] = mapped_column(String(1024))
    extraction_attempt_id: Mapped[Optional[str]] = mapped_column(String(36))
    export_attempt_id: Mapped[Optional[str]] = mapped_column(String(36))
    failure_message: Mapped[Optional[str]] = mapped_column(String(1000))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now
    )
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    documents: Mapped[List["Document"]] = relationship(
        back_populates="job", cascade="all, delete-orphan"
    )
    price_resolutions: Mapped[List["PriceResolution"]] = relationship(
        back_populates="job", cascade="all, delete-orphan"
    )
    completed_documents: Mapped[List["CompletedDocument"]] = relationship(
        back_populates="job"
    )
    products: Mapped[List["ProductIndex"]] = relationship(
        back_populates="job", cascade="all, delete-orphan"
    )
