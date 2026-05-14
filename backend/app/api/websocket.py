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

from fastapi import APIRouter, Cookie, WebSocket, WebSocketDisconnect
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from app.core.config import settings
from app.core.dependencies import get_db, get_redis
from app.core.logging import get_logger
from app.core.websocket_manager import ws_manager
from app.models.user import User
from app.repositories.message_repository import MessageRepository
from app.repositories.room_repository import RoomRepository
from app.repositories.user_repository import UserRepository
from app.schemas.message import MessageCreate
from app.services.message_service import MessageService
from app.services.presence_service import PresenceService

log = get_logger(__name__)
router = APIRouter(tags=["websocket"])

_signer = URLSafeTimedSerializer(settings.SECRET_KEY, salt="session")
_PLAINTEXT_FIELDS = frozenset({"content", "text", "plaintext", "decrypted", "decrypted_text"})


async def _send_error(websocket: WebSocket, code: str, detail: str, **extra) -> None:
    await websocket.send_text(
        json.dumps({"type": "message_error", "code": code, "detail": detail, **extra})
    )


def _message_event(event_type: str, msg, client_message_id: str | None = None) -> dict:
    payload = msg.model_dump(mode="json")
    payload["type"] = event_type
    payload["message_id"] = payload.pop("id")
    if client_message_id:
        payload["client_message_id"] = client_message_id
    return payload


def _contains_plaintext_field(payload: dict) -> bool:
    return any(field in payload for field in _PLAINTEXT_FIELDS)


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
    try:
        return await repo.get_by_id(user_id)
    except Exception as exc:
        log.error("ws_auth_lookup_failed", error_type=exc.__class__.__name__)
        raise


@router.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    session: str | None = Cookie(None, alias=settings.SESSION_COOKIE_NAME),
) -> None:
    async for db in get_db():
        try:
            user = await _authenticate_ws(session, db)
        except Exception:
            await websocket.close(code=1011, reason="Authentication service unavailable")
            return
        if not user:
            await websocket.close(code=4001, reason="Unauthenticated")
            return

        redis = await get_redis()
        presence = PresenceService(redis)
        room_repo = RoomRepository(db)
        message_service = MessageService(MessageRepository(db), room_repo)

        await ws_manager.connect(user.id, websocket)
        await websocket.send_text(
            json.dumps({"type": "connected", "user_id": str(user.id)})
        )
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
                    await _send_error(websocket, "invalid_json", "Invalid JSON")
                    continue

                msg_type = msg.get("type")

                if msg_type == "heartbeat":
                    await presence.refresh(user.id)
                    await websocket.send_text(json.dumps({"type": "heartbeat_ack"}))

                elif msg_type == "encrypted_message":
                    client_message_id = msg.get("client_message_id")
                    try:
                        if _contains_plaintext_field(msg):
                            await _send_error(
                                websocket,
                                "plaintext_rejected",
                                "Messages must be encrypted before sending",
                                client_message_id=client_message_id,
                            )
                            continue
                        room_id = uuid.UUID(str(msg.get("room_id")))
                        body = MessageCreate(
                            client_message_id=client_message_id,
                            recipient_id=msg.get("recipient_id"),
                            ciphertext=msg.get("ciphertext"),
                            encrypted_header=msg.get("encrypted_header"),
                            nonce=msg.get("nonce"),
                            algorithm=msg.get("algorithm") or "AES-256-GCM",
                            attachment_ids=msg.get("attachment_ids") or [],
                        )
                        saved = await message_service.send_message(room_id, user.id, body)
                        await db.commit()
                        response = message_service.to_response(saved)
                        event = _message_event("encrypted_message", response, client_message_id)
                        member_ids = await message_service.room_member_ids(room_id)
                        recipient_ids = [uid for uid in member_ids if uid != user.id]
                        sent_count = await ws_manager.broadcast_to_users(recipient_ids, event)
                        await ws_manager.send_to_user(user.id, event)
                        if sent_count > 0 and recipient_ids:
                            await message_service.mark_delivered(saved.id, recipient_ids[0])
                            await db.commit()
                            await ws_manager.send_to_user(
                                user.id,
                                {
                                    "type": "delivery_receipt",
                                    "room_id": str(room_id),
                                    "message_id": str(saved.id),
                                    "status": "delivered",
                                    "client_message_id": client_message_id,
                                },
                            )
                    except Exception as exc:
                        await db.rollback()
                        log.warning("ws_encrypted_message_failed", user_id=str(user.id), error=str(exc))
                        await _send_error(
                            websocket,
                            "message_send_failed",
                            str(exc),
                            client_message_id=client_message_id,
                        )

                elif msg_type in ("typing_start", "typing_stop"):
                    room_id = msg.get("room_id")
                    if room_id:
                        # Broadcast to room members
                        try:
                            room_uuid = uuid.UUID(room_id)
                            membership = await room_repo.get_membership(room_uuid, user.id)
                            room = await room_repo.get_by_id(room_uuid) if membership else None
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
                            saved = await message_service.mark_read(
                                uuid.UUID(message_id), user.id
                            )
                            await db.commit()
                            await ws_manager.broadcast_to_users(
                                await message_service.room_member_ids(saved.room_id),
                                {
                                    "type": "read_receipt",
                                    "room_id": str(saved.room_id),
                                    "message_id": str(saved.id),
                                    "reader_id": str(user.id),
                                    "status": "read",
                                },
                                exclude=user.id,
                            )
                        except ValueError:
                            pass
                        except Exception as exc:
                            await db.rollback()
                            await _send_error(websocket, "read_receipt_failed", str(exc))

                elif msg_type == "delivery_receipt":
                    message_id = msg.get("message_id")
                    if message_id:
                        try:
                            saved = await message_service.mark_delivered(
                                uuid.UUID(message_id), user.id
                            )
                            await db.commit()
                            await ws_manager.broadcast_to_users(
                                await message_service.room_member_ids(saved.room_id),
                                {
                                    "type": "delivery_receipt",
                                    "room_id": str(saved.room_id),
                                    "message_id": str(saved.id),
                                    "status": "delivered",
                                    "recipient_id": str(user.id),
                                },
                                exclude=user.id,
                            )
                        except ValueError:
                            pass
                        except Exception as exc:
                            await db.rollback()
                            await _send_error(websocket, "delivery_receipt_failed", str(exc))

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
