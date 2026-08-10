"""add export attempt ownership

Revision ID: d96a45b602d1
Revises: 66fac7749a8c
Create Date: 2026-08-08 00:00:00.000000
"""
from typing import Optional, Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d96a45b602d1"
down_revision: Optional[str] = "66fac7749a8c"
branch_labels: Optional[Union[str, Sequence[str]]] = None
depends_on: Optional[Union[str, Sequence[str]]] = None


def upgrade() -> None:
    with op.batch_alter_table("jobs") as batch_op:
        batch_op.add_column(
            sa.Column("export_attempt_id", sa.String(length=36), nullable=True)
        )


def downgrade() -> None:
    with op.batch_alter_table("jobs") as batch_op:
        batch_op.drop_column("export_attempt_id")
