"""Presence service — tracks online/offline status in Redis."""

from __future__ import annotations

import uuid

import redis.asyncio as aioredis

from app.core.config import settings
from app.core.logging import get_logger

log = get_logger(__name__)

_PRESENCE_PREFIX = "presence:"
_PRESENCE_TTL = settings.WS_HEARTBEAT_INTERVAL * 3  # 3 missed heartbeats = offline


class PresenceService:
    def __init__(self, redis: aioredis.Redis) -> None:
        self._redis = redis

    async def set_online(self, user_id: uuid.UUID) -> None:
        key = f"{_PRESENCE_PREFIX}{user_id}"
        await self._redis.setex(key, _PRESENCE_TTL, "online")

    async def set_offline(self, user_id: uuid.UUID) -> None:
        key = f"{_PRESENCE_PREFIX}{user_id}"
        await self._redis.delete(key)

    async def is_online(self, user_id: uuid.UUID) -> bool:
        key = f"{_PRESENCE_PREFIX}{user_id}"
        val = await self._redis.get(key)
        return val is not None

    async def refresh(self, user_id: uuid.UUID) -> None:
        """Refresh TTL on heartbeat."""
        key = f"{_PRESENCE_PREFIX}{user_id}"
        await self._redis.expire(key, _PRESENCE_TTL)

    async def get_online_users(self, user_ids: list[uuid.UUID]) -> set[uuid.UUID]:
        if not user_ids:
            return set()
        keys = [f"{_PRESENCE_PREFIX}{uid}" for uid in user_ids]
        pipeline = self._redis.pipeline()
        for key in keys:
            pipeline.exists(key)
        results = await pipeline.execute()
        return {uid for uid, exists in zip(user_ids, results) if exists}
