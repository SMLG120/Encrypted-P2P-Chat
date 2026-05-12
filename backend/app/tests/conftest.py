"""
Test configuration and shared fixtures.
Uses in-memory SQLite for speed; fakeredis for Redis.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncGenerator
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio
from fakeredis.aioredis import FakeRedis
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.dependencies import create_session_cookie, get_db, get_redis
from app.core.config import settings
from app.main import create_app
from app.models.base import Base
from app.models import *  # noqa: F401,F403 — import all models for metadata


# ── Database ──────────────────────────────────────────────────────────────────

TEST_DB_URL = "sqlite+aiosqlite:///:memory:"

test_engine = create_async_engine(TEST_DB_URL, echo=False)
TestSession = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)


@pytest_asyncio.fixture(scope="function")
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with TestSession() as session:
        yield session
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest_asyncio.fixture
async def fake_redis() -> FakeRedis:
    return FakeRedis()


# ── App ───────────────────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def client(db_session: AsyncSession, fake_redis: FakeRedis) -> AsyncGenerator[AsyncClient, None]:
    app = create_app()

    async def override_db():
        yield db_session

    async def override_redis():
        return fake_redis

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_redis] = override_redis

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as ac:
        yield ac


# ── Helper factories ──────────────────────────────────────────────────────────

async def create_test_user(session: AsyncSession, username: str = "alice") -> Any:
    from app.repositories.user_repository import UserRepository
    repo = UserRepository(session)
    user = await repo.create(username=username, display_name=username.title())
    await session.commit()
    return user


def make_session_cookie(user_id: uuid.UUID) -> str:
    return create_session_cookie(user_id)
