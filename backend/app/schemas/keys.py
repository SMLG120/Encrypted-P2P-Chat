"""Pydantic schemas for cryptographic key management."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class IdentityKeyUpload(BaseModel):
    """Public identity material uploaded after registration."""

    identity_public_key: str = Field(..., description="X25519 public key (base64url)")
    signing_public_key: str = Field(..., description="Ed25519 public key (base64url)")


class SignedPrekeyUpload(BaseModel):
    key_id: int
    public_key: str = Field(..., description="X25519 prekey (base64url)")
    signature: str = Field(..., description="Ed25519 signature over public_key (base64url)")


class OneTimePrekeyUpload(BaseModel):
    key_id: int
    public_key: str = Field(..., description="X25519 OPK (base64url)")


class KeyBundleUpload(BaseModel):
    """Full key bundle uploaded by the client after registration."""

    identity: IdentityKeyUpload
    signed_prekey: SignedPrekeyUpload
    one_time_prekeys: list[OneTimePrekeyUpload] = Field(..., max_length=100)


class KeyBundleResponse(BaseModel):
    """
    Key bundle returned to an initiating user for X3DH.
    Contains ONLY public key material — never private keys.
    """

    user_id: uuid.UUID
    identity_public_key: str
    signing_public_key: str
    signed_prekey: SignedPrekeyResponse
    one_time_prekey: OneTimePrekeyResponse | None = None


class SignedPrekeyResponse(BaseModel):
    key_id: int
    public_key: str
    signature: str


class OneTimePrekeyResponse(BaseModel):
    key_id: int
    public_key: str


class KeyStatusResponse(BaseModel):
    one_time_prekeys_remaining: int
    signed_prekey_active: bool
    identity_key_uploaded: bool
    needs_replenishment: bool
