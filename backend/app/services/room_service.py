"""Room service — conversation management."""

from __future__ import annotations

import uuid

from app.core.exceptions import ForbiddenError, RoomNotFoundError, UserNotFoundError
from app.core.logging import get_logger
from app.models.room import Room
from app.repositories.room_repository import RoomRepository
from app.repositories.user_repository import UserRepository

log = get_logger(__name__)


class RoomService:
    def __init__(self, room_repo: RoomRepository, user_repo: UserRepository) -> None:
        self._rooms = room_repo
        self._users = user_repo

    async def create_or_get_direct_room(
        self, initiator_id: uuid.UUID, partner_id: uuid.UUID
    ) -> Room:
        """Create a direct room or return existing one."""
        if initiator_id == partner_id:
            raise ForbiddenError("You cannot create a direct room with yourself")

        partner = await self._users.get_by_id(partner_id)
        if not partner:
            raise UserNotFoundError("User not found")

        existing = await self._rooms.find_direct_room(initiator_id, partner_id)
        if existing:
            return existing

        room = await self._rooms.create(type="direct", created_by=initiator_id)
        await self._rooms.add_member(room.id, initiator_id, role="owner")
        await self._rooms.add_member(room.id, partner_id, role="member")
        log.info("direct_room_created", room_id=str(room.id))
        loaded = await self._rooms.get_by_id(room.id)
        return loaded or room

    async def create_group_room(
        self, creator_id: uuid.UUID, member_ids: list[uuid.UUID]
    ) -> Room:
        for uid in member_ids:
            if uid == creator_id:
                continue
            if not await self._users.get_by_id(uid):
                raise UserNotFoundError("User not found")

        room = await self._rooms.create(type="group", created_by=creator_id)
        await self._rooms.add_member(room.id, creator_id, role="owner")
        for uid in member_ids:
            if uid != creator_id:
                await self._rooms.add_member(room.id, uid, role="member")
        loaded = await self._rooms.get_by_id(room.id)
        return loaded or room

    async def get_room_for_user(self, room_id: uuid.UUID, user_id: uuid.UUID) -> Room:
        room = await self._rooms.get_by_id(room_id)
        if not room:
            raise RoomNotFoundError()
        membership = await self._rooms.get_membership(room_id, user_id)
        if not membership:
            raise ForbiddenError("You are not a member of this room")
        return room

    async def list_rooms(self, user_id: uuid.UUID) -> list[Room]:
        return await self._rooms.get_rooms_for_user(user_id)

    async def add_member(
        self, room_id: uuid.UUID, requester_id: uuid.UUID, target_user_id: uuid.UUID
    ) -> None:
        membership = await self._rooms.get_membership(room_id, requester_id)
        if not membership or membership.role != "owner":
            raise ForbiddenError("Only room owners can add members")
        await self._rooms.add_member(room_id, target_user_id)

    async def remove_member(
        self, room_id: uuid.UUID, requester_id: uuid.UUID, target_user_id: uuid.UUID
    ) -> None:
        membership = await self._rooms.get_membership(room_id, requester_id)
        if not membership:
            raise ForbiddenError("You are not a member of this room")
        if requester_id != target_user_id and membership.role != "owner":
            raise ForbiddenError("Only owners can remove other members")
        await self._rooms.remove_member(room_id, target_user_id)
