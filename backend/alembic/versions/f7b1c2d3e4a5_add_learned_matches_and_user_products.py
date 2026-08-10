"""add learned matches and user products

Revision ID: f7b1c2d3e4a5
Revises: e53a81f0bd21
Create Date: 2026-08-09 12:00:00.000000
"""
from typing import Optional, Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "f7b1c2d3e4a5"
down_revision: Optional[str] = "e53a81f0bd21"
branch_labels: Optional[Union[str, Sequence[str]]] = None
depends_on: Optional[Union[str, Sequence[str]]] = None


def upgrade() -> None:
    with op.batch_alter_table("product_index") as batch_op:
        batch_op.add_column(
            sa.Column(
                "is_user_created",
                sa.Boolean(),
                server_default=sa.text("0"),
                nullable=False,
            )
        )

    op.create_table(
        "learned_matches",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("alias_type", sa.String(length=20), nullable=False),
        sa.Column("alias_value", sa.String(length=1000), nullable=False),
        sa.Column("product_code", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "alias_type IN ('code', 'name_spec')",
            name=op.f("ck_learned_matches_alias_type"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_learned_matches")),
        sa.UniqueConstraint(
            "alias_type", "alias_value", name="uq_learned_match_alias"
        ),
    )
    op.create_index(
        op.f("ix_learned_matches_product_code"),
        "learned_matches",
        ["product_code"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_learned_matches_product_code"), table_name="learned_matches"
    )
    op.drop_table("learned_matches")
    with op.batch_alter_table("product_index") as batch_op:
        batch_op.drop_column("is_user_created")
