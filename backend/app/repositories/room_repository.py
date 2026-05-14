"""Room repository."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.membership import Membership
from app.models.room import Room


class RoomRepository:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def create(self, type: str, created_by: uuid.UUID) -> Room:
        room = Room(type=type, created_by=created_by)
        self._db.add(room)
        await self._db.flush()
        return room

    async def get_by_id(self, room_id: uuid.UUID) -> Room | None:
        result = await self._db.execute(
            select(Room)
            .options(selectinload(Room.memberships).selectinload(Membership.user))
            .where(Room.id == room_id)
        )
        return result.scalar_one_or_none()

    async def get_rooms_for_user(self, user_id: uuid.UUID) -> list[Room]:
        result = await self._db.execute(
            select(Room)
            .join(Membership, Room.id == Membership.room_id)
            .where(Membership.user_id == user_id)
            .options(selectinload(Room.memberships).selectinload(Membership.user))
        )
        return result.scalars().unique().all()

    async def find_direct_room(
        self, user_a: uuid.UUID, user_b: uuid.UUID
    ) -> Room | None:
        """Find existing direct room between two users."""
        result = await self._db.execute(
            select(Room)
            .join(Membership, Room.id == Membership.room_id)
            .where(Room.type == "direct")
            .where(Membership.user_id == user_a)
            .where(
                Room.id.in_(
                    select(Membership.room_id).where(Membership.user_id == user_b)
                )
            )
            .options(selectinload(Room.memberships).selectinload(Membership.user))
        )
        return result.scalars().first()

    async def add_member(
        self, room_id: uuid.UUID, user_id: uuid.UUID, role: str = "member"
    ) -> Membership:
        membership = Membership(room_id=room_id, user_id=user_id, role=role)
        self._db.add(membership)
        await self._db.flush()
        return membership

    async def remove_member(self, room_id: uuid.UUID, user_id: uuid.UUID) -> bool:
        result = await self._db.execute(
            select(Membership).where(
                Membership.room_id == room_id,
                Membership.user_id == user_id,
            )
        )
        membership = result.scalar_one_or_none()
        if membership:
            await self._db.delete(membership)
            await self._db.flush()
            return True
        return False

    async def get_membership(
        self, room_id: uuid.UUID, user_id: uuid.UUID
    ) -> Membership | None:
        result = await self._db.execute(
            select(Membership).where(
                Membership.room_id == room_id,
                Membership.user_id == user_id,
            )
        )
        return result.scalar_one_or_none()
