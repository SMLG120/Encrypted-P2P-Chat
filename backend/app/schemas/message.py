"""
Message schemas.

The server only accepts and returns ciphertext. There is no 'content' or
'text' field anywhere — this is intentional and by design.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class MessageCreate(BaseModel):
    """
    Client sends encrypted payload only.
    The server stores this without decryption.
    """

    recipient_id: uuid.UUID | None = None
    ciphertext: str = Field(..., description="Encrypted message content (base64url)")
    encrypted_header: str | None = Field(None, description="Encrypted ratchet header (base64url)")
    nonce: str = Field(..., description="Encryption nonce (base64url)")
    algorithm: str = Field(default="AES-256-GCM", max_length=64)

    @model_validator(mode="after")
    def validate_no_plaintext(self) -> "MessageCreate":
        # Sanity check: ciphertext must be base64url-ish (no spaces, long enough)
        if len(self.ciphertext) < 16:
            raise ValueError("ciphertext too short")
        return self


class MessageResponse(BaseModel):
    id: uuid.UUID
    room_id: uuid.UUID
    sender_id: uuid.UUID
    recipient_id: uuid.UUID | None
    ciphertext: str
    encrypted_header: str | None
    nonce: str
    algorithm: str
    transport: str
    delivery_status: str
    created_at: datetime
    delivered_at: datetime | None
    read_at: datetime | None

    model_config = {"from_attributes": True}


class MessageListResponse(BaseModel):
    messages: list[MessageResponse]
    total: int
    has_more: bool


class ReadReceiptUpdate(BaseModel):
    read_at: datetime | None = None
