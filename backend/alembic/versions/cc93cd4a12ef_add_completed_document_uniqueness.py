"""add completed document uniqueness

Revision ID: cc93cd4a12ef
Revises: d96a45b602d1
Create Date: 2026-08-08 00:10:00.000000
"""
from typing import Optional, Sequence, Union

from alembic import op


revision: str = "cc93cd4a12ef"
down_revision: Optional[str] = "d96a45b602d1"
branch_labels: Optional[Union[str, Sequence[str]]] = None
depends_on: Optional[Union[str, Sequence[str]]] = None


def upgrade() -> None:
    with op.batch_alter_table("completed_documents") as batch_op:
        batch_op.create_unique_constraint(
            "uq_completed_documents_image_sha256", ["image_sha256"]
        )
        batch_op.create_unique_constraint(
            "uq_completed_documents_document_identity_key",
            ["document_identity_key"],
        )
        batch_op.create_unique_constraint(
            "uq_completed_documents_item_signature", ["item_signature"]
        )


def downgrade() -> None:
    with op.batch_alter_table("completed_documents") as batch_op:
        batch_op.drop_constraint(
            "uq_completed_documents_item_signature", type_="unique"
        )
        batch_op.drop_constraint(
            "uq_completed_documents_document_identity_key", type_="unique"
        )
        batch_op.drop_constraint(
            "uq_completed_documents_image_sha256", type_="unique"
        )
