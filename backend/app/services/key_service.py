"""Key service — manages X3DH public key material."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from app.core.config import settings
from app.core.exceptions import NoPrekeysAvailableError
from app.core.logging import get_logger
from app.repositories.key_repository import KeyRepository
from app.schemas.keys import (
    KeyBundleResponse,
    KeyBundleUpload,
    KeyStatusResponse,
    OneTimePrekeyResponse,
    SignedPrekeyResponse,
)

log = get_logger(__name__)


class KeyService:
    def __init__(self, key_repo: KeyRepository) -> None:
        self._keys = key_repo

    async def upload_bundle(self, user_id: uuid.UUID, bundle: KeyBundleUpload) -> None:
        """Store public key bundle after registration."""
        await self._keys.upsert_identity_key(
            user_id=user_id,
            identity_public_key=bundle.identity.identity_public_key,
            signing_public_key=bundle.identity.signing_public_key,
        )
        expires_at = datetime.now(timezone.utc) + timedelta(
            days=settings.SIGNED_PREKEY_ROTATION_DAYS
        )
        await self._keys.add_signed_prekey(
            user_id=user_id,
            key_id=bundle.signed_prekey.key_id,
            public_key=bundle.signed_prekey.public_key,
            signature=bundle.signed_prekey.signature,
            expires_at=expires_at,
        )
        await self._keys.add_one_time_prekeys(
            user_id=user_id,
            prekeys=[{"key_id": k.key_id, "public_key": k.public_key} for k in bundle.one_time_prekeys],
        )
        log.info("key_bundle_uploaded", user_id=str(user_id))

    async def get_key_bundle(self, target_user_id: uuid.UUID) -> KeyBundleResponse:
        """Fetch a key bundle for X3DH session initiation."""
        identity = await self._keys.get_identity_key(target_user_id)
        if not identity:
            raise ValueError(f"No identity key for user {target_user_id}")

        signed_pk = await self._keys.get_active_signed_prekey(target_user_id)
        if not signed_pk:
            raise ValueError(f"No active signed prekey for user {target_user_id}")

        # Atomically consume one OPK (may be None if exhausted)
        opk = await self._keys.consume_one_time_prekey(target_user_id)
        if opk is None:
            log.warning("no_opk_available", user_id=str(target_user_id))

        return KeyBundleResponse(
            user_id=target_user_id,
            identity_public_key=identity.identity_public_key,
            signing_public_key=identity.signing_public_key,
            signed_prekey=SignedPrekeyResponse(
                key_id=signed_pk.key_id,
                public_key=signed_pk.public_key,
                signature=signed_pk.signature,
            ),
            one_time_prekey=OneTimePrekeyResponse(
                key_id=opk.key_id,
                public_key=opk.public_key,
            ) if opk else None,
        )

    async def get_status(self, user_id: uuid.UUID) -> KeyStatusResponse:
        identity = await self._keys.get_identity_key(user_id)
        signed_pk = await self._keys.get_active_signed_prekey(user_id)
        opk_count = await self._keys.count_available_opks(user_id)
        return KeyStatusResponse(
            one_time_prekeys_remaining=opk_count,
            signed_prekey_active=signed_pk is not None,
            identity_key_uploaded=identity is not None,
            needs_replenishment=opk_count < settings.MIN_ONE_TIME_PREKEYS,
        )

    async def replenish_prekeys(self, user_id: uuid.UUID, prekeys: list[dict]) -> int:
        return await self._keys.add_one_time_prekeys(user_id, prekeys)
