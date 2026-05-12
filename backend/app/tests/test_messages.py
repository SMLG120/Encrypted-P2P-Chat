"""
Message storage tests.

KEY SECURITY TEST: Verify that:
1. The server only accepts ciphertext (no 'content' or 'text' field).
2. Stored messages contain ciphertext, not plaintext.
3. The API response contains ciphertext, not plaintext.
4. Trying to send plaintext in the 'content' field fails (field doesn't exist).
"""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.message import Message
from app.tests.conftest import create_test_user, make_session_cookie
from app.core.config import settings


def _cookies(user):
    return {settings.SESSION_COOKIE_NAME: make_session_cookie(user.id)}


@pytest.mark.asyncio
async def test_send_message_stores_only_ciphertext(client: AsyncClient, db_session: AsyncSession):
    alice = await create_test_user(db_session, "alice_msg")
    bob = await create_test_user(db_session, "bob_msg")

    # Create room
    resp = await client.post(
        "/api/v1/rooms",
        json={"type": "direct", "member_ids": [str(bob.id)]},
        cookies=_cookies(alice),
    )
    assert resp.status_code == 201
    room_id = resp.json()["id"]

    # Send encrypted message (only ciphertext)
    fake_ciphertext = "dGhpcyBpcyBub3QgcGxhaW50ZXh0YXRhbGw="  # base64
    fake_nonce = "bm9uY2VkYXRhYmFzZTY0"
    resp2 = await client.post(
        f"/api/v1/rooms/{room_id}/messages",
        json={
            "recipient_id": str(bob.id),
            "ciphertext": fake_ciphertext,
            "nonce": fake_nonce,
            "algorithm": "AES-256-GCM",
        },
        cookies=_cookies(alice),
    )
    assert resp2.status_code == 201
    msg = resp2.json()

    # Verify response contains ONLY ciphertext, not plaintext
    assert msg["ciphertext"] == fake_ciphertext
    assert "content" not in msg
    assert "text" not in msg
    assert "plaintext" not in msg
    assert "decrypted" not in msg

    # Verify database also only has ciphertext
    row = await db_session.execute(select(Message).where(Message.id == uuid.UUID(msg["id"])))
    db_msg = row.scalar_one_or_none()
    assert db_msg is not None
    assert db_msg.ciphertext == fake_ciphertext


@pytest.mark.asyncio
async def test_cannot_send_plaintext_content_field(client: AsyncClient, db_session: AsyncSession):
    alice = await create_test_user(db_session, "alice_plain")
    bob = await create_test_user(db_session, "bob_plain")

    resp = await client.post(
        "/api/v1/rooms",
        json={"type": "direct", "member_ids": [str(bob.id)]},
        cookies=_cookies(alice),
    )
    room_id = resp.json()["id"]

    # Attempt to send with 'content' field instead of 'ciphertext'
    resp2 = await client.post(
        f"/api/v1/rooms/{room_id}/messages",
        json={
            "content": "Hello in plaintext",  # This field does not exist
            "nonce": "bm9uY2VkYXRhYmFzZTY0",
        },
        cookies=_cookies(alice),
    )
    # Should be rejected (validation error — missing ciphertext)
    assert resp2.status_code == 422


@pytest.mark.asyncio
async def test_list_messages_returns_ciphertext_only(client: AsyncClient, db_session: AsyncSession):
    alice = await create_test_user(db_session, "alice_list")
    bob = await create_test_user(db_session, "bob_list")

    resp = await client.post(
        "/api/v1/rooms",
        json={"type": "direct", "member_ids": [str(bob.id)]},
        cookies=_cookies(alice),
    )
    room_id = resp.json()["id"]

    ciphertexts = [f"Y2lwaGVydGV4dHt7e3t9fX0={i}" for i in range(3)]
    for ct in ciphertexts:
        await client.post(
            f"/api/v1/rooms/{room_id}/messages",
            json={"ciphertext": ct, "nonce": "dGVzdG5vbmNl", "algorithm": "AES-256-GCM"},
            cookies=_cookies(alice),
        )

    resp2 = await client.get(f"/api/v1/rooms/{room_id}/messages", cookies=_cookies(bob))
    assert resp2.status_code == 200
    msgs = resp2.json()["messages"]
    assert len(msgs) == 3
    for msg in msgs:
        assert "ciphertext" in msg
        assert "content" not in msg
        assert "plaintext" not in msg


@pytest.mark.asyncio
async def test_non_member_cannot_read_messages(client: AsyncClient, db_session: AsyncSession):
    alice = await create_test_user(db_session, "alice_nm")
    bob = await create_test_user(db_session, "bob_nm")
    eve = await create_test_user(db_session, "eve_nm")

    resp = await client.post(
        "/api/v1/rooms",
        json={"type": "direct", "member_ids": [str(bob.id)]},
        cookies=_cookies(alice),
    )
    room_id = resp.json()["id"]

    resp2 = await client.get(f"/api/v1/rooms/{room_id}/messages", cookies=_cookies(eve))
    assert resp2.status_code == 403
