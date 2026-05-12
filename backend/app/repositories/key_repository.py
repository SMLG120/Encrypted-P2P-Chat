"""
Key repository — manages X3DH public key material.

SECURITY: The atomic OPK consumption (SELECT FOR UPDATE) is critical to prevent
two concurrent sessions from using the same one-time prekey and breaking
forward secrecy.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.identity_key import IdentityKey
from app.models.one_time_prekey import OneTimePrekey
from app.models.signed_prekey import SignedPrekey


class KeyRepository:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    # ── Identity Keys ─────────────────────────────────────────────────────

    async def upsert_identity_key(
        self,
        user_id: uuid.UUID,
        identity_public_key: str,
        signing_public_key: str,
    ) -> IdentityKey:
        existing = await self.get_identity_key(user_id)
        if existing:
            existing.identity_public_key = identity_public_key
            existing.signing_public_key = signing_public_key
            await self._db.flush()
            return existing
        key = IdentityKey(
            user_id=user_id,
            identity_public_key=identity_public_key,
            signing_public_key=signing_public_key,
        )
        self._db.add(key)
        await self._db.flush()
        return key

    async def get_identity_key(self, user_id: uuid.UUID) -> IdentityKey | None:
        result = await self._db.execute(
            select(IdentityKey).where(IdentityKey.user_id == user_id)
        )
        return result.scalar_one_or_none()

    # ── Signed Prekeys ────────────────────────────────────────────────────

    async def add_signed_prekey(
        self,
        user_id: uuid.UUID,
        key_id: int,
        public_key: str,
        signature: str,
        expires_at: datetime | None = None,
    ) -> SignedPrekey:
        # Deactivate previous active signed prekey
        await self._db.execute(
            update(SignedPrekey)
            .where(SignedPrekey.user_id == user_id, SignedPrekey.is_active == True)
            .values(is_active=False)
        )
        prekey = SignedPrekey(
            user_id=user_id,
            key_id=key_id,
            public_key=public_key,
            signature=signature,
            expires_at=expires_at,
            is_active=True,
        )
        self._db.add(prekey)
        await self._db.flush()
        return prekey

    async def get_active_signed_prekey(self, user_id: uuid.UUID) -> SignedPrekey | None:
        result = await self._db.execute(
            select(SignedPrekey).where(
                SignedPrekey.user_id == user_id,
                SignedPrekey.is_active == True,
            )
        )
        return result.scalar_one_or_none()

    # ── One-time Prekeys ──────────────────────────────────────────────────

    async def add_one_time_prekeys(
        self,
        user_id: uuid.UUID,
        prekeys: list[dict],
    ) -> int:
        """Bulk insert OPKs, return count added."""
        objs = [
            OneTimePrekey(user_id=user_id, key_id=p["key_id"], public_key=p["public_key"])
            for p in prekeys
        ]
        self._db.add_all(objs)
        await self._db.flush()
        return len(objs)

    async def consume_one_time_prekey(self, user_id: uuid.UUID) -> OneTimePrekey | None:
        """
        Atomically mark one OPK as used and return it.
        Uses SELECT FOR UPDATE SKIP LOCKED for concurrent safety.
        """
        # Select one unused key with a row-level lock
        result = await self._db.execute(
            select(OneTimePrekey)
            .where(
                OneTimePrekey.user_id == user_id,
                OneTimePrekey.is_used == False,
            )
            .limit(1)
            .with_for_update(skip_locked=True)
        )
        opk = result.scalar_one_or_none()
        if opk:
            opk.is_used = True
            opk.used_at = datetime.now(timezone.utc)
            await self._db.flush()
        return opk

    async def count_available_opks(self, user_id: uuid.UUID) -> int:
        result = await self._db.execute(
            select(func.count(OneTimePrekey.id)).where(
                OneTimePrekey.user_id == user_id,
                OneTimePrekey.is_used == False,
            )
        )
        return result.scalar_one()
