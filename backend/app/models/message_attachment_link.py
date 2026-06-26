"""Association table linking a single uploaded attachment to one or more
message rows (one row per group-chat recipient can share the same blob)."""

from __future__ import annotations

from sqlalchemy import Column, ForeignKey, Table
from sqlalchemy.dialects.postgresql import UUID

from app.models.base import Base

message_attachment_links = Table(
    "message_attachment_links",
    Base.metadata,
    Column("message_id", UUID(as_uuid=True), ForeignKey("messages.id", ondelete="CASCADE"), primary_key=True),
    Column(
        "attachment_id",
        UUID(as_uuid=True),
        ForeignKey("message_attachments.id", ondelete="CASCADE"),
        primary_key=True,
    ),
)
