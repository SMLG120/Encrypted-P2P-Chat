"""Identity key model — stores ONLY the public X25519 + Ed25519 keys."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.user import User


class IdentityKey(Base):
    """
    Public identity material for a user.
    - identity_public_key: X25519 DH key (base64url)
    - signing_public_key: Ed25519 key for signatures (base64url)

    SECURITY: Private keys are NEVER sent to the server.
    """

    __tablename__ = "identity_keys"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
    )
    identity_public_key: Mapped[str] = mapped_column(String(256), nullable=False)
    signing_public_key: Mapped[str] = mapped_column(String(256), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    user: Mapped["User"] = relationship("User", back_populates="identity_key")
