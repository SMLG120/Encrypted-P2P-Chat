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
import json
from typing import Any

import redis.asyncio as aioredis
from webauthn.helpers import base64url_to_bytes

from app.core.config import settings
from app.core.exceptions import (
    AuthenticationError,
    UsernameConflictError,
    WebAuthnError,
)
from app.core.logging import audit_log, get_logger
from app.core.passkey_manager import passkey_manager
from app.models.user import User
from app.repositories.user_repository import UserRepository

log = get_logger(__name__)

_CHALLENGE_PREFIX = "webauthn_challenge:"


def _challenge_key(flow: str, username: str) -> str:
    return f"{_CHALLENGE_PREFIX}{flow}:{username}"


def _decode_redis_value(value: str | bytes) -> str:
    return value.decode("utf-8") if isinstance(value, bytes) else value


def _credential_id_from_raw(credential_raw: dict[str, Any]) -> bytes:
    raw_id = credential_raw.get("rawId") or credential_raw.get("id")
    if not isinstance(raw_id, str) or not raw_id:
        raise AuthenticationError("Invalid credential ID")
    try:
        return base64url_to_bytes(raw_id)
    except Exception as exc:
        raise AuthenticationError("Invalid credential ID") from exc


def _assert_user_handle_matches(
    credential_raw: dict[str, Any],
    expected_user_id: uuid.UUID,
) -> None:
    response = credential_raw.get("response")
    if not isinstance(response, dict):
        raise AuthenticationError("Invalid passkey response")

    user_handle = response.get("userHandle")
    if user_handle in (None, ""):
        return
    if not isinstance(user_handle, str):
        raise AuthenticationError("Invalid passkey response")

    try:
        actual = base64url_to_bytes(user_handle)
    except Exception as exc:
        raise AuthenticationError("Invalid passkey response") from exc

    expected = str(expected_user_id).encode()
    if actual != expected:
        log.warning(
            "webauthn_user_handle_mismatch",
            expected_user_id=str(expected_user_id),
            actual_handle_length=len(actual),
        )
        raise AuthenticationError("Invalid username or passkey")


class AuthService:
    def __init__(self, user_repo: UserRepository, redis: aioredis.Redis) -> None:
        self._users = user_repo
        self._redis = redis

    async def _store_challenge(
        self,
        flow: str,
        username: str,
        record: dict[str, str],
    ) -> None:
        key = _challenge_key(flow, username)
        await self._redis.setex(
            key,
            settings.WEBAUTHN_CHALLENGE_TTL,
            json.dumps(record),
        )
        log.info(
            "webauthn_challenge_stored",
            flow=flow,
            username=username,
            user_id=record.get("user_id"),
            ttl_seconds=settings.WEBAUTHN_CHALLENGE_TTL,
            rp_id=passkey_manager.rp_id,
            origin=passkey_manager.origin,
        )

    async def _load_challenge(
        self,
        flow: str,
        username: str,
    ) -> dict[str, str] | None:
        key = _challenge_key(flow, username)
        raw = await self._redis.get(key)
        if not raw:
            log.warning("webauthn_challenge_missing", flow=flow, username=username)
            return None

        value = _decode_redis_value(raw)
        try:
            record = json.loads(value)
        except json.JSONDecodeError:
            # Short-lived backward compatibility for challenges created before
            # challenge metadata was stored as JSON.
            record = {"challenge": value}

        if not isinstance(record, dict) or not isinstance(record.get("challenge"), str):
            log.warning("webauthn_challenge_invalid", flow=flow, username=username)
            return None

        return {str(k): str(v) for k, v in record.items()}

    async def _delete_challenge(self, flow: str, username: str) -> None:
        await self._redis.delete(_challenge_key(flow, username))

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

        await self._store_challenge(
            "reg",
            username,
            {
                "challenge": challenge_b64,
                "user_id": str(temp_user_id),
            },
        )

        return options

    async def complete_registration(
        self,
        username: str,
        display_name: str,
        credential_raw: dict[str, Any],
    ) -> User:
        challenge_record = await self._load_challenge("reg", username)
        if not challenge_record:
            raise WebAuthnError("Challenge expired or not found — restart registration")

        expected_user_id = uuid.UUID(challenge_record.get("user_id", str(uuid.uuid4())))

        try:
            verification = passkey_manager.verify_registration(
                credential_raw,
                challenge_record["challenge"],
            )
        finally:
            await self._delete_challenge("reg", username)

        # Create user
        user = await self._users.create(
            username=username,
            display_name=display_name,
            user_id=expected_user_id,
        )

        transports = None
        credential_response = credential_raw.get("response")
        if isinstance(credential_response, dict):
            raw_transports = credential_response.get("transports")
            if isinstance(raw_transports, list):
                transports = [str(t) for t in raw_transports]

        # Store credential (public key only!)
        await self._users.add_credential(
            user_id=user.id,
            credential_id=verification.credential_id,
            public_key=verification.credential_public_key,
            sign_count=verification.sign_count,
            transports=transports,
        )

        log.info(
            "webauthn_registration_verified",
            user_id=str(user.id),
            username=username,
            credential_id_length=len(verification.credential_id),
            public_key_length=len(verification.credential_public_key),
            sign_count=verification.sign_count,
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

        await self._store_challenge(
            "auth",
            username,
            {
                "challenge": challenge_b64,
                "user_id": str(user.id),
            },
        )

        return options

    async def complete_login(
        self,
        username: str,
        credential_raw: dict[str, Any],
    ) -> User:
        challenge_record = await self._load_challenge("auth", username)
        if not challenge_record:
            raise WebAuthnError("Challenge expired — please try again")

        user = await self._users.get_by_username(username)
        if not user:
            raise AuthenticationError("Invalid username or passkey")

        challenge_user_id = challenge_record.get("user_id")
        if challenge_user_id and challenge_user_id != str(user.id):
            log.warning(
                "webauthn_challenge_user_mismatch",
                username=username,
                expected_user_id=str(user.id),
                challenge_user_id=challenge_user_id,
            )
            await self._delete_challenge("auth", username)
            raise AuthenticationError("Invalid username or passkey")

        cred_id_bytes = _credential_id_from_raw(credential_raw)

        cred = await self._users.get_credential_by_id(cred_id_bytes)
        if not cred or cred.user_id != user.id:
            log.warning(
                "webauthn_credential_not_found",
                username=username,
                user_id=str(user.id),
                credential_id_length=len(cred_id_bytes),
            )
            await self._delete_challenge("auth", username)
            raise AuthenticationError("Credential not found for user")

        try:
            _assert_user_handle_matches(credential_raw, user.id)
            verification = passkey_manager.verify_authentication(
                credential_raw=credential_raw,
                expected_challenge_b64=challenge_record["challenge"],
                stored_public_key=cred.public_key,
                stored_sign_count=cred.sign_count,
            )
        finally:
            await self._delete_challenge("auth", username)

        if verification.credential_id != cred.credential_id:
            log.warning(
                "webauthn_verified_credential_mismatch",
                username=username,
                user_id=str(user.id),
                stored_credential_id_length=len(cred.credential_id),
                verified_credential_id_length=len(verification.credential_id),
            )
            raise AuthenticationError("Invalid username or passkey")

        # Update sign count (replay protection)
        previous_sign_count = cred.sign_count
        await self._users.update_sign_count(cred, verification.new_sign_count)

        log.info(
            "webauthn_login_verified",
            user_id=str(user.id),
            username=username,
            credential_id_length=len(cred.credential_id),
            public_key_length=len(cred.public_key),
            previous_sign_count=previous_sign_count,
            new_sign_count=verification.new_sign_count,
            rp_id=passkey_manager.rp_id,
            origin=passkey_manager.origin,
        )
        audit_log("user_logged_in", user_id=user.id)
        return user
