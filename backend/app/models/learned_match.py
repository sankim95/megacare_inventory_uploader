from __future__ import annotations

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.job import new_id, utc_now


class LearnedMatch(Base):
    __tablename__ = "learned_matches"
    __table_args__ = (
        UniqueConstraint("alias_type", "alias_value", name="uq_learned_match_alias"),
        CheckConstraint(
            "alias_type IN ('code', 'name_spec')",
            name="alias_type",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    alias_type: Mapped[str] = mapped_column(String(20), nullable=False)
    alias_value: Mapped[str] = mapped_column(String(1000), nullable=False)
    product_code: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now
    )
