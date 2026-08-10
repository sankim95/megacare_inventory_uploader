from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Any, Optional

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Integer, JSON, String, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.job import new_id, utc_now

if TYPE_CHECKING:
    from app.models.job import Job


class ProductIndex(Base):
    __tablename__ = "product_index"
    __table_args__ = (
        UniqueConstraint("job_id", "product_code", name="uq_product_index_job_product"),
        UniqueConstraint("job_id", "excel_row", name="uq_product_index_job_excel_row"),
        CheckConstraint("excel_row >= 2", name="excel_row_after_header"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    job_id: Mapped[str] = mapped_column(
        ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_code: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    product_name: Mapped[Optional[str]] = mapped_column(String(500))
    specification: Mapped[Optional[str]] = mapped_column(String(500))
    current_stock: Mapped[Optional[Any]] = mapped_column(JSON)
    purchase_price: Mapped[Optional[Any]] = mapped_column(JSON)
    supplier_code: Mapped[Optional[str]] = mapped_column(String(255))
    supplier: Mapped[Optional[str]] = mapped_column(String(500))
    excel_row: Mapped[int] = mapped_column(Integer, nullable=False)
    is_user_created: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("0")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )

    job: Mapped["Job"] = relationship(back_populates="products")
