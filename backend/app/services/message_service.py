"""Message service — stores and retrieves ciphertext only."""

from __future__ import annotations

import uuid

from app.core.exceptions import ForbiddenError, MessageNotFoundError
from app.core.logging import get_logger
from app.models.message import Message
from app.repositories.message_repository import MessageRepository
from app.repositories.room_repository import RoomRepository
from app.schemas.message import MessageCreate, MessageListResponse, MessageResponse

log = get_logger(__name__)


class MessageService:
    def __init__(
        self, message_repo: MessageRepository, room_repo: RoomRepository
    ) -> None:
        self._messages = message_repo
        self._rooms = room_repo

    async def send_message(
        self,
        room_id: uuid.UUID,
        sender_id: uuid.UUID,
        payload: MessageCreate,
    ) -> Message:
        # Verify sender is a member
        membership = await self._rooms.get_membership(room_id, sender_id)
        if not membership:
            raise ForbiddenError("You are not a member of this room")

        # SECURITY: Store only ciphertext — server never decrypts this
        msg = await self._messages.create(
            room_id=room_id,
            sender_id=sender_id,
            ciphertext=payload.ciphertext,
            nonce=payload.nonce,
            algorithm=payload.algorithm,
            recipient_id=payload.recipient_id,
            encrypted_header=payload.encrypted_header,
            transport="stored",
        )
        log.info("message_stored", room_id=str(room_id), message_id=str(msg.id))
        return msg

    async def list_messages(
        self,
        room_id: uuid.UUID,
        user_id: uuid.UUID,
        limit: int = 50,
        before_id: uuid.UUID | None = None,
    ) -> MessageListResponse:
        membership = await self._rooms.get_membership(room_id, user_id)
        if not membership:
            raise ForbiddenError("You are not a member of this room")

        msgs, has_more = await self._messages.get_room_messages(room_id, limit, before_id)
        return MessageListResponse(
            messages=[MessageResponse.model_validate(m) for m in msgs],
            total=len(msgs),
            has_more=has_more,
        )

    async def mark_read(self, message_id: uuid.UUID, reader_id: uuid.UUID) -> None:
        msg = await self._messages.get_by_id(message_id)
        if not msg:
            raise MessageNotFoundError()
        # Verify reader is in the room
        membership = await self._rooms.get_membership(msg.room_id, reader_id)
        if not membership:
            raise ForbiddenError("Cannot mark message in a room you're not in")
        await self._messages.mark_read(message_id)

    async def mark_delivered(self, message_id: uuid.UUID) -> None:
        await self._messages.mark_delivered(message_id)
