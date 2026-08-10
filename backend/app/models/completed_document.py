from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.job import new_id, utc_now

if TYPE_CHECKING:
    from app.models.document import Document
    from app.models.job import Job


class CompletedDocument(Base):
    __tablename__ = "completed_documents"
    __table_args__ = (
        UniqueConstraint(
            "image_sha256", name="uq_completed_documents_image_sha256"
        ),
        UniqueConstraint(
            "document_identity_key",
            name="uq_completed_documents_document_identity_key",
        ),
        UniqueConstraint(
            "item_signature", name="uq_completed_documents_item_signature"
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    job_id: Mapped[str] = mapped_column(
        ForeignKey("jobs.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    source_document_id: Mapped[str] = mapped_column(
        ForeignKey("documents.id", ondelete="RESTRICT"), nullable=False, unique=True
    )
    image_sha256: Mapped[str] = mapped_column(
        String(64), nullable=False, index=True
    )
    document_identity_key: Mapped[Optional[str]] = mapped_column(
        String(512), index=True
    )
    item_signature: Mapped[Optional[str]] = mapped_column(
        String(64), index=True
    )
    completed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )

    job: Mapped["Job"] = relationship(back_populates="completed_documents")
    source_document: Mapped["Document"] = relationship(back_populates="completed_record")
