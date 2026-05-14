"""Message service — stores and retrieves ciphertext only."""

from __future__ import annotations

import uuid
from pathlib import Path

from sqlalchemy.orm.attributes import set_committed_value

from app.core.config import settings
from app.core.exceptions import (
    AttachmentNotFoundError,
    ForbiddenError,
    MessageNotFoundError,
    ValidationError,
)
from app.core.logging import get_logger
from app.models.attachment import MessageAttachment
from app.models.message import Message
from app.repositories.message_repository import MessageRepository
from app.repositories.room_repository import RoomRepository
from app.schemas.message import (
    AttachmentResponse,
    EncryptedPayloadMixin,
    MessageCreate,
    MessageForward,
    MessageListResponse,
    MessageResponse,
    MessageUpdate,
)

log = get_logger(__name__)


class MessageService:
    def __init__(
        self, message_repo: MessageRepository, room_repo: RoomRepository
    ) -> None:
        self._messages = message_repo
        self._rooms = room_repo

    def _attachment_url(self, attachment_id: uuid.UUID) -> str:
        return f"/api/v1/attachments/{attachment_id}/blob"

    def attachment_response(self, attachment: MessageAttachment) -> AttachmentResponse:
        return AttachmentResponse(
            id=attachment.id,
            room_id=attachment.room_id,
            message_id=attachment.message_id,
            uploader_id=attachment.uploader_id,
            filename=attachment.filename,
            mime_type=attachment.mime_type,
            size_bytes=attachment.size_bytes,
            url=self._attachment_url(attachment.id),
            created_at=attachment.created_at,
        )

    def to_response(self, msg: Message) -> MessageResponse:
        return MessageResponse(
            id=msg.id,
            client_message_id=msg.client_message_id,
            room_id=msg.room_id,
            sender_id=msg.sender_id,
            recipient_id=msg.recipient_id,
            ciphertext=msg.ciphertext,
            encrypted_header=msg.encrypted_header,
            nonce=msg.nonce,
            algorithm=msg.algorithm,
            transport=msg.transport,
            delivery_status=msg.delivery_status,
            forwarded_from_message_id=msg.forwarded_from_message_id,
            is_deleted=msg.is_deleted,
            created_at=msg.created_at,
            edited_at=msg.edited_at,
            deleted_at=msg.deleted_at,
            delivered_at=msg.delivered_at,
            read_at=msg.read_at,
            attachments=[self.attachment_response(a) for a in msg.attachments],
        )

    async def room_member_ids(self, room_id: uuid.UUID) -> list[uuid.UUID]:
        room = await self._rooms.get_by_id(room_id)
        if not room:
            return []
        return [m.user_id for m in room.memberships]

    async def _ensure_room_member(self, room_id: uuid.UUID, user_id: uuid.UUID) -> None:
        membership = await self._rooms.get_membership(room_id, user_id)
        if not membership:
            raise ForbiddenError("You are not a member of this room")

    async def _normalize_payload(
        self,
        room_id: uuid.UUID,
        sender_id: uuid.UUID,
        payload: EncryptedPayloadMixin,
    ) -> tuple[uuid.UUID | None, list[MessageAttachment]]:
        await self._ensure_room_member(room_id, sender_id)

        recipient_id = payload.recipient_id
        room = await self._rooms.get_by_id(room_id)
        if not room:
            raise ForbiddenError("You are not a member of this room")

        member_ids = {m.user_id for m in room.memberships}
        if recipient_id:
            if recipient_id not in member_ids:
                raise ForbiddenError("Recipient is not a member of this room")
        elif room.type == "direct":
            recipient_id = next((uid for uid in member_ids if uid != sender_id), None)

        attachments = await self._messages.get_attachments_by_ids(payload.attachment_ids)
        if len(attachments) != len(set(payload.attachment_ids)):
            raise AttachmentNotFoundError()
        for attachment in attachments:
            if attachment.room_id != room_id:
                raise ForbiddenError("Attachment belongs to a different room")
            if attachment.uploader_id != sender_id:
                raise ForbiddenError("You can only send attachments you uploaded")
            if attachment.message_id is not None:
                raise ForbiddenError("Attachment is already linked to a message")

        return recipient_id, attachments

    async def send_message(
        self,
        room_id: uuid.UUID,
        sender_id: uuid.UUID,
        payload: MessageCreate,
    ) -> Message:
        if payload.client_message_id:
            existing = await self._messages.get_by_client_message_id(
                sender_id,
                payload.client_message_id,
            )
            if existing:
                return existing

        recipient_id, attachments = await self._normalize_payload(room_id, sender_id, payload)

        # SECURITY: Store only ciphertext — server never decrypts this
        msg = await self._messages.create(
            room_id=room_id,
            sender_id=sender_id,
            ciphertext=payload.ciphertext,
            nonce=payload.nonce,
            algorithm=payload.algorithm,
            recipient_id=recipient_id,
            encrypted_header=payload.encrypted_header,
            transport="stored",
            client_message_id=payload.client_message_id,
        )
        await self._messages.attach_to_message(attachments, msg.id)
        set_committed_value(msg, "attachments", attachments)
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
        chronological = list(reversed(msgs))
        return MessageListResponse(
            messages=[self.to_response(m) for m in chronological],
            total=len(chronological),
            has_more=has_more,
        )

    async def edit_message(
        self,
        message_id: uuid.UUID,
        sender_id: uuid.UUID,
        payload: MessageUpdate,
    ) -> Message:
        msg = await self._messages.get_by_id(message_id)
        if not msg:
            raise MessageNotFoundError()
        if msg.sender_id != sender_id:
            raise ForbiddenError("Only the sender can edit this message")
        if msg.is_deleted:
            raise ForbiddenError("Deleted messages cannot be edited")

        await self._normalize_payload(msg.room_id, sender_id, payload)
        return await self._messages.update_encrypted_payload(
            msg,
            ciphertext=payload.ciphertext,
            nonce=payload.nonce,
            algorithm=payload.algorithm,
            encrypted_header=payload.encrypted_header,
        )

    async def delete_message(self, message_id: uuid.UUID, sender_id: uuid.UUID) -> Message:
        msg = await self._messages.get_by_id(message_id)
        if not msg:
            raise MessageNotFoundError()
        if msg.sender_id != sender_id:
            raise ForbiddenError("Only the sender can delete this message")
        return await self._messages.soft_delete(msg)

    async def forward_message(
        self,
        message_id: uuid.UUID,
        sender_id: uuid.UUID,
        body: MessageForward,
    ) -> Message:
        source = await self._messages.get_by_id(message_id)
        if not source:
            raise MessageNotFoundError()
        await self._ensure_room_member(source.room_id, sender_id)

        client_message_id = body.client_message_id or body.payload.client_message_id
        if client_message_id:
            existing = await self._messages.get_by_client_message_id(
                sender_id,
                client_message_id,
            )
            if existing:
                return existing

        recipient_id, attachments = await self._normalize_payload(
            body.target_room_id, sender_id, body.payload
        )
        msg = await self._messages.create(
            room_id=body.target_room_id,
            sender_id=sender_id,
            ciphertext=body.payload.ciphertext,
            nonce=body.payload.nonce,
            algorithm=body.payload.algorithm,
            recipient_id=recipient_id,
            encrypted_header=body.payload.encrypted_header,
            transport="stored",
            forwarded_from_message_id=source.id,
            client_message_id=client_message_id,
        )
        await self._messages.attach_to_message(attachments, msg.id)
        set_committed_value(msg, "attachments", attachments)
        log.info(
            "message_forwarded",
            source_message_id=str(source.id),
            message_id=str(msg.id),
            target_room_id=str(body.target_room_id),
        )
        return msg

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
        await self._ensure_room_member(room_id, uploader_id)
        if mime_type not in settings.ATTACHMENT_ALLOWED_MIME_TYPES:
            raise ValidationError("Unsupported attachment type")
        if size_bytes <= 0 or size_bytes > settings.ATTACHMENT_MAX_BYTES + 1024:
            raise ValidationError("Attachment is too large")
        return await self._messages.create_attachment(
            room_id=room_id,
            uploader_id=uploader_id,
            object_key=object_key,
            filename=filename,
            mime_type=mime_type,
            size_bytes=size_bytes,
            sha256=sha256,
        )

    async def get_attachment_for_user(
        self, attachment_id: uuid.UUID, user_id: uuid.UUID
    ) -> MessageAttachment:
        attachment = await self._messages.get_attachment_by_id(attachment_id)
        if not attachment:
            raise AttachmentNotFoundError()
        await self._ensure_room_member(attachment.room_id, user_id)
        return attachment

    async def mark_read(self, message_id: uuid.UUID, reader_id: uuid.UUID) -> Message:
        msg = await self._messages.get_by_id(message_id)
        if not msg:
            raise MessageNotFoundError()
        # Verify reader is in the room
        membership = await self._rooms.get_membership(msg.room_id, reader_id)
        if not membership:
            raise ForbiddenError("Cannot mark message in a room you're not in")
        if msg.sender_id != reader_id:
            await self._messages.mark_read(message_id)
            msg.delivery_status = "read"
        return msg

    async def mark_delivered(self, message_id: uuid.UUID, recipient_id: uuid.UUID) -> Message:
        msg = await self._messages.get_by_id(message_id)
        if not msg:
            raise MessageNotFoundError()
        await self._ensure_room_member(msg.room_id, recipient_id)
        if msg.sender_id != recipient_id and msg.delivery_status == "sent":
            await self._messages.mark_delivered(message_id)
            msg.delivery_status = "delivered"
        return msg

    def attachment_path(self, attachment: MessageAttachment) -> Path:
        return Path(settings.ATTACHMENT_STORAGE_DIR) / attachment.object_key
