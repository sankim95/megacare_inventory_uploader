"""add extraction attempt ownership

Revision ID: e53a81f0bd21
Revises: cc93cd4a12ef
Create Date: 2026-08-08 12:00:00.000000
"""
from typing import Optional, Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "e53a81f0bd21"
down_revision: Optional[str] = "cc93cd4a12ef"
branch_labels: Optional[Union[str, Sequence[str]]] = None
depends_on: Optional[Union[str, Sequence[str]]] = None


def upgrade() -> None:
    with op.batch_alter_table("jobs") as batch_op:
        batch_op.add_column(
            sa.Column("extraction_attempt_id", sa.String(length=36), nullable=True)
        )


def downgrade() -> None:
    with op.batch_alter_table("jobs") as batch_op:
        batch_op.drop_column("extraction_attempt_id")
