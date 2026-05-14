"""
Message schemas.

The server only accepts and returns ciphertext. There is no 'content' or
'text' field anywhere — this is intentional and by design.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from pydantic import BaseModel, Field, model_validator


class EncryptedPayloadMixin(BaseModel):
    recipient_id: uuid.UUID | None = None
    ciphertext: str = Field(..., description="Encrypted message content (base64url)")
    encrypted_header: str | None = Field(None, description="Encrypted ratchet header (base64url)")
    nonce: str = Field(..., description="Encryption nonce (base64url)")
    algorithm: str = Field(default="AES-256-GCM", max_length=64)
    attachment_ids: list[uuid.UUID] = Field(default_factory=list, max_length=10)

    model_config = {"extra": "forbid"}

    @model_validator(mode="after")
    def validate_no_plaintext(self) -> "EncryptedPayloadMixin":
        if len(self.ciphertext) < 16:
            raise ValueError("ciphertext too short")
        if any(char.isspace() for char in self.ciphertext):
            raise ValueError("ciphertext must be encoded, not plaintext")
        if any(char.isspace() for char in self.nonce):
            raise ValueError("nonce must be encoded")
        return self


class MessageCreate(EncryptedPayloadMixin):
    """
    Client sends encrypted payload only.
    The server stores this without decryption.
    """

    client_message_id: str | None = Field(None, max_length=128)


class MessageUpdate(EncryptedPayloadMixin):
    pass


class MessageForward(BaseModel):
    target_room_id: uuid.UUID
    payload: EncryptedPayloadMixin
    client_message_id: str | None = Field(None, max_length=128)

    model_config = {"extra": "forbid"}


class AttachmentResponse(BaseModel):
    id: uuid.UUID
    room_id: uuid.UUID
    message_id: uuid.UUID | None
    uploader_id: uuid.UUID
    filename: str
    mime_type: str
    size_bytes: int
    url: str
    created_at: datetime

    model_config = {"from_attributes": True}


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
    forwarded_from_message_id: uuid.UUID | None
    is_deleted: bool
    created_at: datetime
    edited_at: datetime | None
    deleted_at: datetime | None
    delivered_at: datetime | None
    read_at: datetime | None
    attachments: list[AttachmentResponse] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class MessageListResponse(BaseModel):
    messages: list[MessageResponse]
    total: int
    has_more: bool


class ReadReceiptUpdate(BaseModel):
    read_at: datetime | None = None
