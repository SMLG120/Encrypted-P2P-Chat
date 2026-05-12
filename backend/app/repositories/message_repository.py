"""Message repository — stores and retrieves encrypted messages."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.message import Message


class MessageRepository:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def create(
        self,
        room_id: uuid.UUID,
        sender_id: uuid.UUID,
        ciphertext: str,
        nonce: str,
        algorithm: str,
        recipient_id: uuid.UUID | None = None,
        encrypted_header: str | None = None,
        transport: str = "stored",
    ) -> Message:
        msg = Message(
            room_id=room_id,
            sender_id=sender_id,
            recipient_id=recipient_id,
            ciphertext=ciphertext,
            encrypted_header=encrypted_header,
            nonce=nonce,
            algorithm=algorithm,
            transport=transport,
            delivery_status="sent",
        )
        self._db.add(msg)
        await self._db.flush()
        return msg

    async def get_room_messages(
        self,
        room_id: uuid.UUID,
        limit: int = 50,
        before_id: uuid.UUID | None = None,
    ) -> tuple[list[Message], bool]:
        stmt = select(Message).where(Message.room_id == room_id).order_by(Message.created_at.desc())
        if before_id:
            # Cursor pagination
            ref = await self.get_by_id(before_id)
            if ref:
                stmt = stmt.where(Message.created_at < ref.created_at)
        result = await self._db.execute(stmt.limit(limit + 1))
        msgs = result.scalars().all()
        has_more = len(msgs) > limit
        return list(reversed(msgs[:limit])), has_more

    async def get_by_id(self, message_id: uuid.UUID) -> Message | None:
        result = await self._db.execute(select(Message).where(Message.id == message_id))
        return result.scalar_one_or_none()

    async def mark_delivered(self, message_id: uuid.UUID) -> None:
        await self._db.execute(
            update(Message)
            .where(Message.id == message_id)
            .values(
                delivery_status="delivered",
                delivered_at=datetime.now(timezone.utc),
            )
        )

    async def mark_read(self, message_id: uuid.UUID) -> None:
        await self._db.execute(
            update(Message)
            .where(Message.id == message_id)
            .values(
                delivery_status="read",
                read_at=datetime.now(timezone.utc),
            )
        )
