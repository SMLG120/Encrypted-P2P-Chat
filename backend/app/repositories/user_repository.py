"""User repository — database access layer for User and WebAuthnCredential."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.credential import WebAuthnCredential
from app.models.user import User


class UserRepository:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def create(self, username: str, display_name: str) -> User:
        user = User(username=username, display_name=display_name)
        self._db.add(user)
        await self._db.flush()
        return user

    async def get_by_id(self, user_id: uuid.UUID) -> User | None:
        result = await self._db.execute(select(User).where(User.id == user_id))
        return result.scalar_one_or_none()

    async def get_by_username(self, username: str) -> User | None:
        result = await self._db.execute(select(User).where(User.username == username))
        return result.scalar_one_or_none()

    async def search(self, query: str, limit: int = 20, offset: int = 0) -> tuple[list[User], int]:
        from sqlalchemy import func

        q = f"%{query.lower()}%"
        stmt = select(User).where(
            (func.lower(User.username).like(q)) | (func.lower(User.display_name).like(q))
        )
        count_stmt = select(func.count()).select_from(stmt.subquery())
        total = (await self._db.execute(count_stmt)).scalar_one()
        result = await self._db.execute(stmt.offset(offset).limit(limit))
        return result.scalars().all(), total

    # ── WebAuthn credentials ──────────────────────────────────────────────

    async def add_credential(
        self,
        user_id: uuid.UUID,
        credential_id: bytes,
        public_key: bytes,
        sign_count: int,
        transports: list[str] | None,
    ) -> WebAuthnCredential:
        cred = WebAuthnCredential(
            user_id=user_id,
            credential_id=credential_id,
            public_key=public_key,
            sign_count=sign_count,
            transports=",".join(transports) if transports else None,
        )
        self._db.add(cred)
        await self._db.flush()
        return cred

    async def get_credentials_for_user(self, user_id: uuid.UUID) -> list[WebAuthnCredential]:
        result = await self._db.execute(
            select(WebAuthnCredential).where(WebAuthnCredential.user_id == user_id)
        )
        return result.scalars().all()

    async def get_credential_by_id(self, credential_id: bytes) -> WebAuthnCredential | None:
        result = await self._db.execute(
            select(WebAuthnCredential).where(WebAuthnCredential.credential_id == credential_id)
        )
        return result.scalar_one_or_none()

    async def update_sign_count(
        self, credential: WebAuthnCredential, new_count: int
    ) -> WebAuthnCredential:
        credential.sign_count = new_count
        await self._db.flush()
        return credential
