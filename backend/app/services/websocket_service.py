"""WebSocket event helpers.

This module intentionally does not perform cryptography. It keeps the
real-time route focused on dispatch while centralizing payload safety checks
and event shaping.
"""

from __future__ import annotations

from typing import Any

FORBIDDEN_ENCRYPTED_MESSAGE_FIELDS = frozenset(
    {
        "content",
        "text",
        "plaintext",
        "message_text",
        "decrypted",
        "decrypted_text",
        "decryptedText",
        "private_key",
        "privateKey",
        "ratchet_state",
        "ratchetState",
        "chain_key",
        "chainKey",
        "message_key",
        "messageKey",
    }
)


def contains_forbidden_message_field(value: Any) -> bool:
    """Return True if a WS payload contains plaintext or private key material."""

    if isinstance(value, dict):
        for key, child in value.items():
            if key in FORBIDDEN_ENCRYPTED_MESSAGE_FIELDS:
                return True
            if contains_forbidden_message_field(child):
                return True
        return False

    if isinstance(value, list):
        return any(contains_forbidden_message_field(child) for child in value)

    return False


def message_event(event_type: str, msg: Any, client_message_id: str | None = None) -> dict:
    """Convert a MessageResponse-like object into a WebSocket event payload."""

    payload = msg.model_dump(mode="json")
    payload["type"] = event_type
    payload["message_id"] = payload.pop("id")
    if client_message_id:
        payload["client_message_id"] = client_message_id
    return payload
