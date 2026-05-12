"""Message endpoints — ciphertext in, ciphertext out."""

import uuid

from fastapi import APIRouter, Depends, Query, Request

from app.core.config import settings
from app.core.dependencies import CurrentUser, DbDep
from app.core.rate_limit import limiter
from app.repositories.message_repository import MessageRepository
from app.repositories.room_repository import RoomRepository
from app.schemas.message import MessageCreate, MessageListResponse, MessageResponse
from app.services.message_service import MessageService

router = APIRouter(tags=["messages"])


def _get_message_service(db: DbDep) -> MessageService:
    return MessageService(MessageRepository(db), RoomRepository(db))


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
    # Push over WebSocket to online members
    from app.core.websocket_manager import ws_manager

    msg = await svc.send_message(room_id, current_user.id, body)

    # Notify online room members via WebSocket
    ws_payload = {
        "type": "encrypted_message",
        "room_id": str(room_id),
        "message_id": str(msg.id),
        "sender_id": str(current_user.id),
        "ciphertext": msg.ciphertext,
        "encrypted_header": msg.encrypted_header,
        "nonce": msg.nonce,
        "algorithm": msg.algorithm,
        "created_at": msg.created_at.isoformat(),
    }
    # Fire and forget — don't block the HTTP response
    import asyncio
    asyncio.ensure_future(
        ws_manager.send_to_user(
            uuid.UUID(str(body.recipient_id)) if body.recipient_id else current_user.id,
            ws_payload,
        )
    )

    return MessageResponse.model_validate(msg)


@router.patch("/messages/{message_id}/read")
async def mark_read(
    message_id: uuid.UUID,
    current_user: CurrentUser,
    svc: MessageService = Depends(_get_message_service),
) -> dict:
    await svc.mark_read(message_id, current_user.id)
    return {"message": "Marked as read"}
