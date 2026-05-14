"""Tests for WebSocket payload safety helpers."""

from app.services.websocket_service import contains_forbidden_message_field


def test_websocket_helper_rejects_plaintext_and_key_material_fields() -> None:
    assert contains_forbidden_message_field({"type": "encrypted_message", "content": "hello"})
    assert contains_forbidden_message_field(
        {
            "type": "encrypted_message",
            "payload": {"ratchet_state": {"chain_key": "secret"}},
        }
    )
    assert contains_forbidden_message_field(
        {
            "type": "encrypted_message",
            "attachments": [{"metadata": {"privateKey": "secret"}}],
        }
    )


def test_websocket_helper_allows_ciphertext_only_payload() -> None:
    assert not contains_forbidden_message_field(
        {
            "type": "encrypted_message",
            "room_id": "room-id",
            "recipient_id": "recipient-id",
            "ciphertext": "YWJjZGVmZ2hpamtsbW5vcA",
            "encrypted_header": "aGVhZGVy",
            "nonce": "bm9uY2U",
            "algorithm": "AES-256-GCM",
            "client_message_id": "client-1",
        }
    )
