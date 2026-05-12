"""
WebSocket endpoint — the real-time backbone of the application.

Responsibilities:
1. Authenticate the connecting user via session cookie.
2. Register the connection in the ConnectionManager.
3. Dispatch incoming messages by type.
4. Forward WebRTC signaling (offer/answer/ICE) to target users.
5. Broadcast typing indicators and presence updates to room members.
6. Handle heartbeats for keep-alive and presence refresh.

SECURITY: The server only relays encrypted payloads — it cannot decrypt them.
"""

from __future__ import annotations

import asyncio
import json
import uuid

import redis.asyncio as aioredis
from fastapi import APIRouter, Cookie, Depends, WebSocket, WebSocketDisconnect
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from app.core.config import settings
from app.core.dependencies import get_db, get_redis
from app.core.logging import get_logger
from app.core.websocket_manager import ws_manager
from app.repositories.room_repository import RoomRepository
from app.repositories.user_repository import UserRepository
from app.services.presence_service import PresenceService

log = get_logger(__name__)
router = APIRouter(tags=["websocket"])

_signer = URLSafeTimedSerializer(settings.SECRET_KEY, salt="session")


async def _authenticate_ws(
    session: str | None,
    db,
) -> "User | None":
    if not session:
        return None
    try:
        data = _signer.loads(session, max_age=settings.SESSION_MAX_AGE)
        user_id = uuid.UUID(data["user_id"])
    except (SignatureExpired, BadSignature, KeyError, ValueError):
        return None
    repo = UserRepository(db)
    return await repo.get_by_id(user_id)


@router.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    session: str | None = Cookie(None, alias=settings.SESSION_COOKIE_NAME),
) -> None:
    async for db in get_db():
        user = await _authenticate_ws(session, db)
        if not user:
            await websocket.close(code=4001, reason="Unauthenticated")
            return

        redis = await get_redis()
        presence = PresenceService(redis)
        room_repo = RoomRepository(db)

        await ws_manager.connect(user.id, websocket)
        await presence.set_online(user.id)

        # Broadcast presence to user's room members
        rooms = await room_repo.get_rooms_for_user(user.id)
        all_member_ids: set[uuid.UUID] = set()
        for room in rooms:
            for m in room.memberships:
                if m.user_id != user.id:
                    all_member_ids.add(m.user_id)

        await ws_manager.broadcast_to_users(
            list(all_member_ids),
            {"type": "presence_update", "user_id": str(user.id), "status": "online"},
        )

        try:
            while True:
                try:
                    raw = await asyncio.wait_for(
                        websocket.receive_text(),
                        timeout=settings.WS_HEARTBEAT_INTERVAL * 2,
                    )
                except asyncio.TimeoutError:
                    await websocket.close(code=4002, reason="Heartbeat timeout")
                    break

                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    await websocket.send_text(
                        json.dumps({"type": "error", "code": "invalid_json", "detail": "Invalid JSON"})
                    )
                    continue

                msg_type = msg.get("type")

                if msg_type == "heartbeat":
                    await presence.refresh(user.id)
                    await websocket.send_text(json.dumps({"type": "heartbeat_ack"}))

                elif msg_type == "encrypted_message":
                    # Relay encrypted message to recipient
                    target_id = msg.get("recipient_id") or msg.get("room_id")
                    if target_id:
                        try:
                            await ws_manager.send_to_user(
                                uuid.UUID(str(target_id)),
                                {**msg, "sender_id": str(user.id)},
                            )
                        except ValueError:
                            pass

                elif msg_type in ("typing_start", "typing_stop"):
                    room_id = msg.get("room_id")
                    if room_id:
                        # Broadcast to room members
                        try:
                            room_uuid = uuid.UUID(room_id)
                            room = await room_repo.get_by_id(room_uuid)
                            if room:
                                member_ids = [m.user_id for m in room.memberships]
                                await ws_manager.broadcast_to_users(
                                    member_ids,
                                    {"type": msg_type, "room_id": room_id, "user_id": str(user.id)},
                                    exclude=user.id,
                                )
                        except ValueError:
                            pass

                elif msg_type in ("webrtc_offer", "webrtc_answer", "webrtc_ice_candidate"):
                    # Forward WebRTC signaling to target user
                    target_id = msg.get("target_user_id")
                    if target_id:
                        try:
                            await ws_manager.send_to_user(
                                uuid.UUID(target_id),
                                {**msg, "from_user_id": str(user.id)},
                            )
                        except ValueError:
                            pass

                elif msg_type == "read_receipt":
                    room_id = msg.get("room_id")
                    message_id = msg.get("message_id")
                    if room_id and message_id:
                        # Broadcast receipt to room
                        try:
                            room = await room_repo.get_by_id(uuid.UUID(room_id))
                            if room:
                                member_ids = [m.user_id for m in room.memberships]
                                await ws_manager.broadcast_to_users(
                                    member_ids,
                                    {
                                        "type": "read_receipt",
                                        "room_id": room_id,
                                        "message_id": message_id,
                                        "reader_id": str(user.id),
                                    },
                                    exclude=user.id,
                                )
                        except ValueError:
                            pass

        except WebSocketDisconnect:
            pass
        finally:
            await ws_manager.disconnect(user.id, websocket)
            await presence.set_offline(user.id)
            await ws_manager.broadcast_to_users(
                list(all_member_ids),
                {"type": "presence_update", "user_id": str(user.id), "status": "offline"},
            )
        break
