from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.enums import ResolutionMethod
from app.models.job import new_id, utc_now
from app.models.types import enum_type

if TYPE_CHECKING:
    from app.models.item import Item
    from app.models.job import Job


class PriceResolution(Base):
    __tablename__ = "price_resolutions"
    __table_args__ = (
        UniqueConstraint("job_id", "product_code", name="uq_price_resolutions_job_product"),
        CheckConstraint(
            "resolution_method IN ('unresolved', 'automatic', 'manual')",
            name="resolution_method",
        ),
        CheckConstraint(
            "selected_unit_price IS NULL OR selected_unit_price >= 0",
            name="selected_unit_price_nonnegative",
        ),
        CheckConstraint(
            "resolution_method = 'unresolved' OR selected_unit_price IS NOT NULL",
            name="resolved_requires_price",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    job_id: Mapped[str] = mapped_column(
        ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_code: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    resolution_method: Mapped[ResolutionMethod] = mapped_column(
        enum_type(ResolutionMethod, "resolution_method"),
        nullable=False,
        default=ResolutionMethod.UNRESOLVED,
        server_default=ResolutionMethod.UNRESOLVED.value,
    )
    selected_item_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("items.id", ondelete="SET NULL"), unique=True
    )
    selected_unit_price: Mapped[Optional[int]] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now
    )

    job: Mapped["Job"] = relationship(back_populates="price_resolutions")
    selected_item: Mapped[Optional["Item"]] = relationship(
        back_populates="selected_for_price_resolution"
    )
