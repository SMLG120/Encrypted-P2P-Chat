"""Pydantic schemas for WebAuthn authentication flows."""

from __future__ import annotations

import uuid
from typing import Any

from pydantic import BaseModel, Field, field_validator


class RegistrationOptionsRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=64, pattern=r"^[a-zA-Z0-9_.-]+$")
    display_name: str = Field(..., min_length=1, max_length=128)


class RegistrationOptionsResponse(BaseModel):
    challenge: str
    rp: dict[str, str]
    user: dict[str, str]
    pubKeyCredParams: list[dict[str, Any]]
    timeout: int
    attestation: str
    authenticatorSelection: dict[str, Any]


class RegistrationVerifyRequest(BaseModel):
    username: str
    display_name: str
    credential: dict[str, Any]


class LoginOptionsRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=64)


class LoginOptionsResponse(BaseModel):
    challenge: str
    timeout: int
    rpId: str
    allowCredentials: list[dict[str, Any]]
    userVerification: str


class LoginVerifyRequest(BaseModel):
    username: str
    credential: dict[str, Any]


class UserResponse(BaseModel):
    id: uuid.UUID
    username: str
    display_name: str
    avatar_url: str | None = None

    model_config = {"from_attributes": True}


class AuthResponse(BaseModel):
    user: UserResponse
    message: str = "Authentication successful"
