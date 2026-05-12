"""
FastAPI dependency injection: database sessions, Redis, current user.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncGenerator
from typing import Annotated

import redis.asyncio as aioredis
from fastapi import Cookie, Depends, HTTPException, status
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import AuthenticationError, SessionExpiredError
from app.core.logging import get_logger
from app.db.session import AsyncSessionLocal, redis_pool
from app.models.user import User
from app.repositories.user_repository import UserRepository

log = get_logger(__name__)

_signer = URLSafeTimedSerializer(settings.SECRET_KEY, salt="session")


# ── Database ──────────────────────────────────────────────────────────────────


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


DbDep = Annotated[AsyncSession, Depends(get_db)]


# ── Redis ─────────────────────────────────────────────────────────────────────


async def get_redis() -> aioredis.Redis:
    return aioredis.Redis(connection_pool=redis_pool)


RedisDep = Annotated[aioredis.Redis, Depends(get_redis)]


# ── Session / Auth ────────────────────────────────────────────────────────────


def _decode_session_cookie(cookie: str) -> str:
    """Decode and verify the signed session cookie, returning the user_id."""
    try:
        data = _signer.loads(
            cookie,
            max_age=settings.SESSION_MAX_AGE,
        )
        return data["user_id"]
    except SignatureExpired as exc:
        raise SessionExpiredError() from exc
    except (BadSignature, KeyError) as exc:
        raise AuthenticationError() from exc


def create_session_cookie(user_id: uuid.UUID) -> str:
    """Create a signed session cookie value."""
    return _signer.dumps({"user_id": str(user_id)})


async def get_current_user(
    db: DbDep,
    session: Annotated[str | None, Cookie(alias=settings.SESSION_COOKIE_NAME)] = None,
) -> User:
    if not session:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    try:
        user_id_str = _decode_session_cookie(session)
        user_id = uuid.UUID(user_id_str)
    except (AuthenticationError, SessionExpiredError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc),
        ) from exc

    repo = UserRepository(db)
    user = await repo.get_by_id(user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )

    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
