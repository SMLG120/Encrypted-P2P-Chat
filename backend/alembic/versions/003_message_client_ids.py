"""Add message client idempotency keys

Revision ID: 003
Revises: 002
Create Date: 2026-05-14
"""

from alembic import op
import sqlalchemy as sa

revision = "003"
down_revision = "002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("messages", sa.Column("client_message_id", sa.String(length=128), nullable=True))
    op.create_unique_constraint(
        "uq_messages_sender_client_id",
        "messages",
        ["sender_id", "client_message_id"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_messages_sender_client_id", "messages", type_="unique")
    op.drop_column("messages", "client_message_id")
