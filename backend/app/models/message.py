"""
Message model.

SECURITY: The ciphertext column contains the ONLY form of the message the
server ever sees.  Plaintext is generated and consumed exclusively on the
client.  The server must NEVER receive or store plaintext.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Enum, ForeignKey, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.room import Room
    from app.models.user import User


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    room_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("rooms.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sender_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # nullable for group; set for direct messages
    recipient_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # ── Encrypted payload ─────────────────────────────────────────────────
    # ciphertext: AES-256-GCM or XChaCha20-Poly1305 ciphertext (base64url)
    ciphertext: Mapped[str] = mapped_column(Text, nullable=False)
    # encrypted_header: Double-Ratchet header fields, encrypted (base64url)
    encrypted_header: Mapped[str | None] = mapped_column(Text, nullable=True)
    # nonce: encryption nonce (base64url)
    nonce: Mapped[str] = mapped_column(Text, nullable=False)
    # algorithm label — informational, not used for server-side decryption
    algorithm: Mapped[str] = mapped_column(Text, nullable=False, default="AES-256-GCM")

    # ── Transport & delivery ──────────────────────────────────────────────
    transport: Mapped[str] = mapped_column(
        Enum("webrtc", "websocket", "stored", name="transport_type"),
        nullable=False,
        default="stored",
    )
    delivery_status: Mapped[str] = mapped_column(
        Enum("sending", "sent", "delivered", "read", "failed", name="delivery_status"),
        nullable=False,
        default="sent",
    )

    # ── Timestamps ────────────────────────────────────────────────────────
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    room: Mapped["Room"] = relationship("Room", back_populates="messages")
    sender: Mapped["User"] = relationship(
        "User", back_populates="sent_messages", foreign_keys=[sender_id]
    )
