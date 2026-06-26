"""Message endpoints — ciphertext in, ciphertext out."""

import hashlib
import re
import uuid

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile
from fastapi.responses import Response

from app.core.attachment_storage import AttachmentStorage, get_attachment_storage
from app.core.config import settings
from app.core.dependencies import CurrentUser, DbDep
from app.core.exceptions import AttachmentBlobMissingError, ValidationError
from app.core.rate_limit import limiter
from app.repositories.message_repository import MessageRepository
from app.repositories.room_repository import RoomRepository
from app.schemas.message import (
    AttachmentResponse,
    MessageCreate,
    MessageForward,
    MessageListResponse,
    MessageResponse,
    MessageUpdate,
)
from app.services.message_service import MessageService

router = APIRouter(tags=["messages"])
_SAFE_FILENAME = re.compile(r"[^A-Za-z0-9_.-]+")


def _get_message_service(db: DbDep) -> MessageService:
    return MessageService(MessageRepository(db), RoomRepository(db))


def _message_event(event_type: str, msg: MessageResponse, client_message_id: str | None = None) -> dict:
    payload = msg.model_dump(mode="json")
    payload["type"] = event_type
    payload["message_id"] = payload.pop("id")
    if client_message_id:
        payload["client_message_id"] = client_message_id
    return payload


async def _broadcast_room_event(
    svc: MessageService,
    room_id: uuid.UUID,
    payload: dict,
    exclude: uuid.UUID | None = None,
) -> int:
    from app.core.websocket_manager import ws_manager

    member_ids = await svc.room_member_ids(room_id)
    return await ws_manager.broadcast_to_users(member_ids, payload, exclude=exclude)


async def _broadcast_message_event(
    svc: MessageService,
    msg: MessageResponse,
    payload: dict,
    sender_id: uuid.UUID,
) -> int:
    from app.core.websocket_manager import ws_manager

    class _MessageRef:
        room_id = msg.room_id
        sender_id = msg.sender_id
        recipient_id = msg.recipient_id

    target_ids = await svc.event_target_ids(_MessageRef())
    recipient_targets = [uid for uid in target_ids if uid != sender_id]
    sent_count = await ws_manager.broadcast_to_users(recipient_targets, payload)
    if sender_id in target_ids:
        await ws_manager.send_to_user(sender_id, payload)
    return sent_count


async def _send_delivery_receipt(
    svc: MessageService,
    msg: MessageResponse,
    sender_id: uuid.UUID,
    sent_count: int,
) -> None:
    if sent_count <= 0:
        return
    from app.core.websocket_manager import ws_manager

    recipient_id = msg.recipient_id
    if recipient_id is None:
        recipient_id = next((uid for uid in await svc.room_member_ids(msg.room_id) if uid != sender_id), None)
    if recipient_id is not None:
        await svc.mark_delivered(msg.id, recipient_id)
    await ws_manager.send_to_user(
        sender_id,
        {
            "type": "delivery_receipt",
            "room_id": str(msg.room_id),
            "message_id": str(msg.id),
            "status": "delivered",
        },
    )


@router.get("/rooms/{room_id}/messages")
async def list_messages(
    room_id: uuid.UUID,
    current_user: CurrentUser,
    limit: int = Query(50, ge=1, le=100),
    before_id: uuid.UUID | None = Query(None),
    svc: MessageService = Depends(_get_message_service),
) -> MessageListResponse:
    return await svc.list_messages(room_id, current_user.id, limit=limit, before_id=before_id)


@router.post("/rooms/{room_id}/messages", status_code=201)
@limiter.limit(settings.RATE_LIMIT_MESSAGES)
async def send_message(
    request: Request,
    room_id: uuid.UUID,
    body: MessageCreate,
    current_user: CurrentUser,
    svc: MessageService = Depends(_get_message_service),
) -> MessageResponse:
    msg = await svc.send_message(room_id, current_user.id, body)
    response = svc.to_response(msg)

    sent_count = await _broadcast_message_event(
        svc,
        response,
        _message_event("encrypted_message", response, body.client_message_id),
        current_user.id,
    )
    await _send_delivery_receipt(svc, response, current_user.id, sent_count)

    return response


@router.patch("/messages/{message_id}")
async def edit_message(
    message_id: uuid.UUID,
    body: MessageUpdate,
    current_user: CurrentUser,
    svc: MessageService = Depends(_get_message_service),
) -> MessageResponse:
    msg = await svc.edit_message(message_id, current_user.id, body)
    response = svc.to_response(msg)
    await _broadcast_message_event(
        svc,
        response,
        _message_event("message_edited", response),
        current_user.id,
    )
    return response


@router.delete("/messages/{message_id}")
async def delete_message(
    message_id: uuid.UUID,
    current_user: CurrentUser,
    svc: MessageService = Depends(_get_message_service),
) -> MessageResponse:
    msg = await svc.delete_message(message_id, current_user.id)
    response = svc.to_response(msg)
    await _broadcast_message_event(
        svc,
        response,
        _message_event("message_deleted", response),
        current_user.id,
    )
    return response


@router.post("/messages/{message_id}/forward", status_code=201)
async def forward_message(
    message_id: uuid.UUID,
    body: MessageForward,
    current_user: CurrentUser,
    svc: MessageService = Depends(_get_message_service),
) -> MessageResponse:
    msg = await svc.forward_message(message_id, current_user.id, body)
    response = svc.to_response(msg)
    await _broadcast_message_event(
        svc,
        response,
        _message_event("message_forwarded", response, body.client_message_id),
        current_user.id,
    )
    return response


@router.post("/rooms/{room_id}/attachments", status_code=201)
@limiter.limit(settings.RATE_LIMIT_UPLOADS)
async def upload_attachment(
    request: Request,
    room_id: uuid.UUID,
    current_user: CurrentUser,
    file: UploadFile = File(...),
    filename: str = Form(...),
    mime_type: str = Form(...),
    size_bytes: int = Form(...),
    svc: MessageService = Depends(_get_message_service),
    storage: AttachmentStorage = Depends(get_attachment_storage),
) -> AttachmentResponse:
    sanitized = _SAFE_FILENAME.sub("_", filename).strip("._") or "attachment.bin"
    data = await file.read(settings.ATTACHMENT_MAX_BYTES + 1025)
    if len(data) > settings.ATTACHMENT_MAX_BYTES + 1024:
        raise ValidationError("Attachment is too large")
    sha256 = hashlib.sha256(data).hexdigest()
    # object_key is always server-generated — never derived from the
    # client-supplied filename — so neither storage backend is exposed to
    # path traversal via this value.
    object_key = f"{uuid.uuid4()}.bin"

    attachment = await svc.create_attachment(
        room_id=room_id,
        uploader_id=current_user.id,
        object_key=object_key,
        filename=sanitized,
        mime_type=mime_type,
        size_bytes=size_bytes if size_bytes > 0 else len(data),
        sha256=sha256,
    )

    await storage.save(object_key, data)
    response = svc.attachment_response(attachment)
    await _broadcast_room_event(
        svc,
        room_id,
        {"type": "attachment_uploaded", **response.model_dump(mode="json")},
        exclude=current_user.id,
    )
    return response


@router.get("/attachments/{attachment_id}/blob")
async def get_attachment_blob(
    attachment_id: uuid.UUID,
    current_user: CurrentUser,
    svc: MessageService = Depends(_get_message_service),
    storage: AttachmentStorage = Depends(get_attachment_storage),
) -> Response:
    # get_attachment_for_user already raises AttachmentNotFoundError (404)
    # if the row itself doesn't exist, or ForbiddenError (403) if the
    # caller isn't a member of the room it belongs to. Reaching this point
    # means the row exists and the caller is authorized — if the blob is
    # still missing, that's a distinct "it existed but the file is gone"
    # case (410), not "not found" (404) or "forbidden" (403).
    attachment = await svc.get_attachment_for_user(attachment_id, current_user.id)
    data = await storage.load(attachment.object_key)
    if data is None:
        raise AttachmentBlobMissingError()
    return Response(
        content=data,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{attachment.filename}"'},
    )


@router.patch("/messages/{message_id}/read")
async def mark_read(
    message_id: uuid.UUID,
    current_user: CurrentUser,
    svc: MessageService = Depends(_get_message_service),
) -> dict:
    msg = await svc.mark_read(message_id, current_user.id)
    await _broadcast_room_event(
        svc,
        msg.room_id,
        {
            "type": "read_receipt",
            "room_id": str(msg.room_id),
            "message_id": str(msg.id),
            "reader_id": str(current_user.id),
            "status": "read",
        },
        exclude=current_user.id,
    )
    return {"message": "Marked as read"}
