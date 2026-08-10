"""add image correction fields

Revision ID: 66fac7749a8c
Revises: b4c956721987
Create Date: 2026-08-07 21:15:00.000000
"""
from typing import Optional, Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "66fac7749a8c"
down_revision: Optional[str] = "b4c956721987"
branch_labels: Optional[Union[str, Sequence[str]]] = None
depends_on: Optional[Union[str, Sequence[str]]] = None


def upgrade() -> None:
    with op.batch_alter_table("documents") as batch_op:
        batch_op.add_column(
            sa.Column(
                "correction_applied",
                sa.Boolean(),
                server_default=sa.text("0"),
                nullable=False,
            )
        )
        batch_op.add_column(
            sa.Column("correction_warning", sa.String(length=1000), nullable=True)
        )
    with op.batch_alter_table("items") as batch_op:
        batch_op.add_column(sa.Column("confidence", sa.Float(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("items") as batch_op:
        batch_op.drop_column("confidence")
    with op.batch_alter_table("documents") as batch_op:
        batch_op.drop_column("correction_warning")
        batch_op.drop_column("correction_applied")
