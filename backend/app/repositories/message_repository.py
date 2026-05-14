"""Message repository — stores and retrieves encrypted messages."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.attachment import MessageAttachment
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
        forwarded_from_message_id: uuid.UUID | None = None,
        client_message_id: str | None = None,
    ) -> Message:
        msg = Message(
            room_id=room_id,
            sender_id=sender_id,
            recipient_id=recipient_id,
            client_message_id=client_message_id,
            ciphertext=ciphertext,
            encrypted_header=encrypted_header,
            nonce=nonce,
            algorithm=algorithm,
            transport=transport,
            delivery_status="sent",
            forwarded_from_message_id=forwarded_from_message_id,
            created_at=datetime.now(timezone.utc),
        )
        self._db.add(msg)
        await self._db.flush()
        return msg

    async def get_by_client_message_id(
        self,
        sender_id: uuid.UUID,
        client_message_id: str,
    ) -> Message | None:
        result = await self._db.execute(
            select(Message)
            .where(
                Message.sender_id == sender_id,
                Message.client_message_id == client_message_id,
            )
            .options(selectinload(Message.attachments))
        )
        return result.scalar_one_or_none()

    async def update_encrypted_payload(
        self,
        msg: Message,
        ciphertext: str,
        nonce: str,
        algorithm: str,
        encrypted_header: str | None,
    ) -> Message:
        msg.ciphertext = ciphertext
        msg.nonce = nonce
        msg.algorithm = algorithm
        msg.encrypted_header = encrypted_header
        msg.edited_at = datetime.now(timezone.utc)
        msg.delivery_status = "sent"
        await self._db.flush()
        return msg

    async def soft_delete(self, msg: Message) -> Message:
        msg.is_deleted = True
        msg.deleted_at = datetime.now(timezone.utc)
        msg.ciphertext = "__deleted__"
        msg.encrypted_header = None
        msg.nonce = "__deleted__"
        msg.delivery_status = "sent"
        await self._db.flush()
        return msg

    async def get_room_messages(
        self,
        room_id: uuid.UUID,
        limit: int = 50,
        before_id: uuid.UUID | None = None,
    ) -> tuple[list[Message], bool]:
        stmt = (
            select(Message)
            .where(Message.room_id == room_id)
            .options(selectinload(Message.attachments))
            .order_by(Message.created_at.desc())
        )
        if before_id:
            # Cursor pagination
            ref = await self.get_by_id(before_id)
            if ref:
                stmt = stmt.where(Message.created_at < ref.created_at)
        result = await self._db.execute(stmt.limit(limit + 1))
        msgs = result.scalars().all()
        has_more = len(msgs) > limit
        return msgs[:limit], has_more

    async def get_by_id(self, message_id: uuid.UUID) -> Message | None:
        result = await self._db.execute(
            select(Message)
            .where(Message.id == message_id)
            .options(selectinload(Message.attachments))
        )
        return result.scalar_one_or_none()

    async def create_attachment(
        self,
        room_id: uuid.UUID,
        uploader_id: uuid.UUID,
        object_key: str,
        filename: str,
        mime_type: str,
        size_bytes: int,
        sha256: str,
    ) -> MessageAttachment:
        attachment = MessageAttachment(
            room_id=room_id,
            uploader_id=uploader_id,
            object_key=object_key,
            filename=filename,
            mime_type=mime_type,
            size_bytes=size_bytes,
            sha256=sha256,
        )
        self._db.add(attachment)
        await self._db.flush()
        return attachment

    async def get_attachment_by_id(
        self, attachment_id: uuid.UUID
    ) -> MessageAttachment | None:
        result = await self._db.execute(
            select(MessageAttachment).where(MessageAttachment.id == attachment_id)
        )
        return result.scalar_one_or_none()

    async def get_attachments_by_ids(
        self, attachment_ids: list[uuid.UUID]
    ) -> list[MessageAttachment]:
        if not attachment_ids:
            return []
        result = await self._db.execute(
            select(MessageAttachment).where(MessageAttachment.id.in_(attachment_ids))
        )
        return result.scalars().all()

    async def attach_to_message(
        self, attachments: list[MessageAttachment], message_id: uuid.UUID
    ) -> None:
        for attachment in attachments:
            attachment.message_id = message_id
        await self._db.flush()

    async def mark_delivered(self, message_id: uuid.UUID) -> None:
        await self._db.execute(
            update(Message)
            .where(Message.id == message_id)
            .values(
                delivery_status="delivered",
                delivered_at=datetime.now(timezone.utc),
            )
        )
        await self._db.flush()

    async def mark_read(self, message_id: uuid.UUID) -> None:
        await self._db.execute(
            update(Message)
            .where(Message.id == message_id)
            .values(
                delivery_status="read",
                read_at=datetime.now(timezone.utc),
            )
        )
        await self._db.flush()
