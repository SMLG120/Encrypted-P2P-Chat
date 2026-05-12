from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    display_name: Mapped[str] = mapped_column(String(128), nullable=False)
    avatar_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # Relationships
    credentials: Mapped[list["WebAuthnCredential"]] = relationship(
        "WebAuthnCredential", back_populates="user", cascade="all, delete-orphan"
    )
    identity_key: Mapped["IdentityKey | None"] = relationship(
        "IdentityKey", back_populates="user", uselist=False, cascade="all, delete-orphan"
    )
    signed_prekeys: Mapped[list["SignedPrekey"]] = relationship(
        "SignedPrekey", back_populates="user", cascade="all, delete-orphan"
    )
    one_time_prekeys: Mapped[list["OneTimePrekey"]] = relationship(
        "OneTimePrekey", back_populates="user", cascade="all, delete-orphan"
    )
    memberships: Mapped[list["Membership"]] = relationship(
        "Membership", back_populates="user", cascade="all, delete-orphan"
    )
    sent_messages: Mapped[list["Message"]] = relationship(
        "Message", back_populates="sender", foreign_keys="Message.sender_id"
    )

    def __repr__(self) -> str:
        return f"<User id={self.id} username={self.username!r}>"


# Avoid circular import — import here for type-checking only
from app.models.credential import WebAuthnCredential  # noqa: E402
from app.models.identity_key import IdentityKey  # noqa: E402
from app.models.membership import Membership  # noqa: E402
from app.models.message import Message  # noqa: E402
from app.models.one_time_prekey import OneTimePrekey  # noqa: E402
from app.models.signed_prekey import SignedPrekey  # noqa: E402
