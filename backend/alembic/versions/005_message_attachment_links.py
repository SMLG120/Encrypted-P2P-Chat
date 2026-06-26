"""Allow one uploaded attachment to be linked to multiple message rows

A single encrypted attachment blob is uploaded once but, in a group room,
must be linked to every per-recipient message row that references it. The
old `message_attachments.message_id` column could only point at one message,
so only the first recipient's row kept the link after a reload. This
replaces it with a many-to-many join table.

Revision ID: 005
Revises: 004
Create Date: 2026-06-26
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "005"
down_revision = "004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "message_attachment_links",
        sa.Column("message_id", UUID(as_uuid=True), sa.ForeignKey("messages.id", ondelete="CASCADE"), primary_key=True),
        sa.Column(
            "attachment_id",
            UUID(as_uuid=True),
            sa.ForeignKey("message_attachments.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )
    op.create_index(
        "ix_message_attachment_links_attachment_id",
        "message_attachment_links",
        ["attachment_id"],
    )

    # Backfill existing single links into the join table.
    op.execute(
        """
        INSERT INTO message_attachment_links (message_id, attachment_id)
        SELECT message_id, id FROM message_attachments WHERE message_id IS NOT NULL
        """
    )

    op.drop_index("ix_message_attachments_message_id", table_name="message_attachments")
    op.drop_column("message_attachments", "message_id")


def downgrade() -> None:
    op.add_column(
        "message_attachments",
        sa.Column("message_id", UUID(as_uuid=True), sa.ForeignKey("messages.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_index("ix_message_attachments_message_id", "message_attachments", ["message_id"])

    op.execute(
        """
        UPDATE message_attachments
        SET message_id = links.message_id
        FROM (
            SELECT DISTINCT ON (attachment_id) attachment_id, message_id
            FROM message_attachment_links
            ORDER BY attachment_id, message_id
        ) AS links
        WHERE message_attachments.id = links.attachment_id
        """
    )

    op.drop_index("ix_message_attachment_links_attachment_id", table_name="message_attachment_links")
    op.drop_table("message_attachment_links")
