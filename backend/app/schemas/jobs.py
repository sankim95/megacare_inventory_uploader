from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, ConfigDict

from app.models.enums import JobStatus
from app.schemas.common import UtcDateTime


class JobRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    status: JobStatus
    original_excel_name: Optional[str]
    original_excel_sha256: Optional[str]
    approved_by: Optional[str]
    result_path: Optional[str]
    failure_message: Optional[str]
    product_count: int = 0
    created_at: UtcDateTime
    updated_at: UtcDateTime
    completed_at: Optional[UtcDateTime]
