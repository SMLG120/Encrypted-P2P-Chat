"""
WebSocket connection manager.

Maintains a mapping of user_id → set[WebSocket] so we can:
- Push messages to specific users
- Broadcast to all members of a room
- Forward WebRTC signaling (offer/answer/ICE) peer-to-peer via server relay
"""

from __future__ import annotations

import asyncio
import json
import uuid
from collections import defaultdict

from fastapi import WebSocket
from starlette.websockets import WebSocketState

from app.core.config import settings
from app.core.logging import get_logger

log = get_logger(__name__)


class ConnectionManager:
    def __init__(self) -> None:
        # user_id → list of active WebSocket connections
        self._connections: dict[str, list[WebSocket]] = defaultdict(list)
        self._lock = asyncio.Lock()

    async def connect(self, user_id: uuid.UUID, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            conns = self._connections[str(user_id)]
            if len(conns) >= settings.WS_MAX_CONNECTIONS_PER_USER:
                # Reject oldest connection
                old = conns.pop(0)
                try:
                    await old.close(code=4001, reason="Replaced by newer connection")
                except Exception:
                    pass
            conns.append(ws)
        log.info("ws_connected", user_id=str(user_id))

    async def disconnect(self, user_id: uuid.UUID, ws: WebSocket) -> None:
        async with self._lock:
            conns = self._connections.get(str(user_id), [])
            if ws in conns:
                conns.remove(ws)
            if not conns:
                self._connections.pop(str(user_id), None)
        log.info("ws_disconnected", user_id=str(user_id))

    def is_online(self, user_id: uuid.UUID) -> bool:
        return bool(self._connections.get(str(user_id)))

    async def send_to_user(self, user_id: uuid.UUID, message: dict) -> int:
        """Send to all WebSocket connections of a user. Returns number sent."""
        data = json.dumps(message)
        conns = list(self._connections.get(str(user_id), []))
        sent = 0
        dead: list[WebSocket] = []
        for ws in conns:
            try:
                if ws.client_state == WebSocketState.CONNECTED:
                    await ws.send_text(data)
                    sent += 1
                else:
                    dead.append(ws)
            except Exception as exc:
                log.warning("ws_send_failed", user_id=str(user_id), error=str(exc))
                dead.append(ws)
        # Clean up dead connections
        if dead:
            async with self._lock:
                for d in dead:
                    try:
                        self._connections[str(user_id)].remove(d)
                    except ValueError:
                        pass
        return sent

    async def broadcast_to_users(
        self, user_ids: list[uuid.UUID], message: dict, exclude: uuid.UUID | None = None
    ) -> None:
        tasks = [
            self.send_to_user(uid, message)
            for uid in user_ids
            if exclude is None or uid != exclude
        ]
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    def get_online_user_ids(self) -> set[str]:
        return {uid for uid, conns in self._connections.items() if conns}


# Global singleton — shared across all requests
ws_manager = ConnectionManager()
