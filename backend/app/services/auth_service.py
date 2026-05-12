"""
Auth service — orchestrates WebAuthn registration and login flows.

Challenge lifecycle:
  1. Client requests registration/login options.
  2. Server generates a random challenge, stores it in Redis with TTL.
  3. Client signs the challenge with the authenticator.
  4. Server verifies, removes the challenge, and creates/validates session.

The challenge is deleted after first use to prevent replay attacks.
"""

from __future__ import annotations

import uuid
from typing import Any

import redis.asyncio as aioredis

from app.core.config import settings
from app.core.exceptions import (
    AuthenticationError,
    ConflictError,
    UsernameConflictError,
    WebAuthnError,
)
from app.core.logging import audit_log, get_logger
from app.core.passkey_manager import passkey_manager
from app.models.user import User
from app.repositories.user_repository import UserRepository

log = get_logger(__name__)

_CHALLENGE_PREFIX = "webauthn_challenge:"


class AuthService:
    def __init__(self, user_repo: UserRepository, redis: aioredis.Redis) -> None:
        self._users = user_repo
        self._redis = redis

    # ── Registration ──────────────────────────────────────────────────────

    async def begin_registration(
        self, username: str, display_name: str
    ) -> dict[str, Any]:
        existing = await self._users.get_by_username(username)
        if existing:
            raise UsernameConflictError(f"Username '{username}' is already taken")

        # Use a temporary user_id; the real one is created on verify
        temp_user_id = uuid.uuid4()
        options, challenge_b64 = passkey_manager.generate_registration_options(
            user_id=temp_user_id,
            username=username,
            display_name=display_name,
        )

        # Store challenge in Redis with TTL
        key = f"{_CHALLENGE_PREFIX}reg:{username}"
        await self._redis.setex(key, settings.WEBAUTHN_CHALLENGE_TTL, challenge_b64)

        return options

    async def complete_registration(
        self,
        username: str,
        display_name: str,
        credential_raw: dict[str, Any],
    ) -> User:
        key = f"{_CHALLENGE_PREFIX}reg:{username}"
        challenge_b64 = await self._redis.get(key)
        if not challenge_b64:
            raise WebAuthnError("Challenge expired or not found — restart registration")

        verification = passkey_manager.verify_registration(credential_raw, challenge_b64)

        # Delete challenge to prevent replay
        await self._redis.delete(key)

        # Create user
        user = await self._users.create(username=username, display_name=display_name)

        # Store credential (public key only!)
        await self._users.add_credential(
            user_id=user.id,
            credential_id=verification.credential_id,
            public_key=verification.credential_public_key,
            sign_count=verification.sign_count,
            transports=None,
        )

        audit_log("user_registered", user_id=user.id, username=username)
        return user

    # ── Login ─────────────────────────────────────────────────────────────

    async def begin_login(self, username: str) -> dict[str, Any]:
        user = await self._users.get_by_username(username)
        if not user:
            # Timing-safe: return generic error but don't reveal existence
            raise AuthenticationError("Invalid username or passkey")

        credentials = await self._users.get_credentials_for_user(user.id)
        if not credentials:
            raise AuthenticationError("No credentials registered for this user")

        options, challenge_b64 = passkey_manager.generate_authentication_options(
            credentials=[c.credential_id for c in credentials]
        )

        key = f"{_CHALLENGE_PREFIX}auth:{username}"
        await self._redis.setex(key, settings.WEBAUTHN_CHALLENGE_TTL, challenge_b64)

        return options

    async def complete_login(
        self,
        username: str,
        credential_raw: dict[str, Any],
    ) -> User:
        key = f"{_CHALLENGE_PREFIX}auth:{username}"
        challenge_b64 = await self._redis.get(key)
        if not challenge_b64:
            raise WebAuthnError("Challenge expired — please try again")

        user = await self._users.get_by_username(username)
        if not user:
            raise AuthenticationError("Invalid username or passkey")

        # Find the matching credential
        raw_id = credential_raw.get("rawId") or credential_raw.get("id", "")
        from webauthn.helpers import base64url_to_bytes

        try:
            cred_id_bytes = base64url_to_bytes(raw_id)
        except Exception:
            raise AuthenticationError("Invalid credential ID")

        cred = await self._users.get_credential_by_id(cred_id_bytes)
        if not cred or cred.user_id != user.id:
            raise AuthenticationError("Credential not found for user")

        verification = passkey_manager.verify_authentication(
            credential_raw=credential_raw,
            expected_challenge_b64=challenge_b64,
            stored_public_key=cred.public_key,
            stored_sign_count=cred.sign_count,
        )

        # Delete challenge
        await self._redis.delete(key)

        # Update sign count (replay protection)
        await self._users.update_sign_count(cred, verification.new_sign_count)

        audit_log("user_logged_in", user_id=user.id)
        return user
