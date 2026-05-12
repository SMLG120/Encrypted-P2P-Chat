"""
WebSocket message schemas.

All message types are tagged unions so the client/server
can dispatch on 'type' without examining payload content.
"""

from __future__ import annotations

import uuid
from typing import Any, Literal

from pydantic import BaseModel, Field


class WSBaseMessage(BaseModel):
    type: str


class WSEncryptedMessage(WSBaseMessage):
    type: Literal["encrypted_message"]
    room_id: str
    message_id: str
    sender_id: str
    ciphertext: str
    encrypted_header: str | None = None
    nonce: str
    algorithm: str = "AES-256-GCM"


class WSTypingStart(WSBaseMessage):
    type: Literal["typing_start"]
    room_id: str
    user_id: str


class WSTypingStop(WSBaseMessage):
    type: Literal["typing_stop"]
    room_id: str
    user_id: str


class WSPresenceUpdate(WSBaseMessage):
    type: Literal["presence_update"]
    user_id: str
    status: Literal["online", "offline", "away"]


class WSReadReceipt(WSBaseMessage):
    type: Literal["read_receipt"]
    room_id: str
    message_id: str
    reader_id: str


class WSDeliveryReceipt(WSBaseMessage):
    type: Literal["delivery_receipt"]
    message_id: str
    status: str


class WSWebRTCOffer(WSBaseMessage):
    type: Literal["webrtc_offer"]
    room_id: str
    target_user_id: str
    sdp: str


class WSWebRTCAnswer(WSBaseMessage):
    type: Literal["webrtc_answer"]
    room_id: str
    target_user_id: str
    sdp: str


class WSWebRTCIceCandidate(WSBaseMessage):
    type: Literal["webrtc_ice_candidate"]
    room_id: str
    target_user_id: str
    candidate: dict[str, Any]


class WSError(WSBaseMessage):
    type: Literal["error"]
    code: str
    detail: str


class WSHeartbeat(WSBaseMessage):
    type: Literal["heartbeat"]


class WSHeartbeatAck(WSBaseMessage):
    type: Literal["heartbeat_ack"]
