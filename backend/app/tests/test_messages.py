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
async def test_two_users_can_send_and_fetch_saved_direct_message_history(
    client: AsyncClient,
    db_session: AsyncSession,
):
    alice = await create_test_user(db_session, "alice_history")
    bob = await create_test_user(db_session, "bob_history")

    room = await client.post(
        "/api/v1/rooms",
        json={"type": "direct", "member_ids": [str(bob.id)]},
        cookies=_cookies(alice),
    )
    assert room.status_code == 201
    room_id = room.json()["id"]

    alice_msg = {
        "recipient_id": str(bob.id),
        "ciphertext": "YWxpY2UtY2lwaGVydGV4dC1vbmx5",
        "encrypted_header": "YWxpY2UtaGVhZGVy",
        "nonce": "YWxpY2Utbm9uY2U",
        "algorithm": "AES-256-GCM",
    }
    bob_msg = {
        "recipient_id": str(alice.id),
        "ciphertext": "Ym9iLWNpcGhlcnRleHQtb25seQ",
        "encrypted_header": "Ym9iLWhlYWRlcg",
        "nonce": "Ym9iLW5vbmNl",
        "algorithm": "AES-256-GCM",
    }

    assert (
        await client.post(
            f"/api/v1/rooms/{room_id}/messages",
            json=alice_msg,
            cookies=_cookies(alice),
        )
    ).status_code == 201
    assert (
        await client.post(
            f"/api/v1/rooms/{room_id}/messages",
            json=bob_msg,
            cookies=_cookies(bob),
        )
    ).status_code == 201

    alice_history = await client.get(
        f"/api/v1/rooms/{room_id}/messages",
        cookies=_cookies(alice),
    )
    bob_history = await client.get(
        f"/api/v1/rooms/{room_id}/messages",
        cookies=_cookies(bob),
    )

    assert alice_history.status_code == 200
    assert bob_history.status_code == 200
    assert [m["ciphertext"] for m in alice_history.json()["messages"]] == [
        alice_msg["ciphertext"],
        bob_msg["ciphertext"],
    ]
    assert bob_history.json()["messages"] == alice_history.json()["messages"]

    rows = (await db_session.execute(select(Message).where(Message.room_id == uuid.UUID(room_id)))).scalars().all()
    assert {row.ciphertext for row in rows} == {
        alice_msg["ciphertext"],
        bob_msg["ciphertext"],
    }
    assert all("Hello" not in row.ciphertext for row in rows)


@pytest.mark.asyncio
async def test_client_message_id_is_idempotent_for_retry(
    client: AsyncClient,
    db_session: AsyncSession,
):
    alice = await create_test_user(db_session, "alice_idempotent")
    bob = await create_test_user(db_session, "bob_idempotent")
    room_id = (
        await client.post(
            "/api/v1/rooms",
            json={"type": "direct", "member_ids": [str(bob.id)]},
            cookies=_cookies(alice),
        )
    ).json()["id"]

    payload = {
        "client_message_id": "client-retry-1",
        "recipient_id": str(bob.id),
        "ciphertext": "cmV0cnktY2lwaGVydGV4dC1vbmx5",
        "encrypted_header": "cmV0cnktaGVhZGVy",
        "nonce": "cmV0cnktbm9uY2U",
        "algorithm": "AES-256-GCM",
    }
    first = await client.post(
        f"/api/v1/rooms/{room_id}/messages",
        json=payload,
        cookies=_cookies(alice),
    )
    second = await client.post(
        f"/api/v1/rooms/{room_id}/messages",
        json=payload,
        cookies=_cookies(alice),
    )

    assert first.status_code == 201
    assert second.status_code == 201
    assert second.json()["id"] == first.json()["id"]

    rows = (await db_session.execute(select(Message).where(Message.room_id == uuid.UUID(room_id)))).scalars().all()
    assert len(rows) == 1


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


@pytest.mark.asyncio
async def test_sender_can_edit_and_delete_own_message(client: AsyncClient, db_session: AsyncSession):
    alice = await create_test_user(db_session, "alice_edit")
    bob = await create_test_user(db_session, "bob_edit")

    room_resp = await client.post(
        "/api/v1/rooms",
        json={"type": "direct", "member_ids": [str(bob.id)]},
        cookies=_cookies(alice),
    )
    room_id = room_resp.json()["id"]
    send_resp = await client.post(
        f"/api/v1/rooms/{room_id}/messages",
        json={"ciphertext": "Y2lwaGVydGV4dC1lZGl0LTEyMw", "nonce": "bm9uY2UtZWRpdA"},
        cookies=_cookies(alice),
    )
    message_id = send_resp.json()["id"]

    denied = await client.patch(
        f"/api/v1/messages/{message_id}",
        json={"ciphertext": "Ym9iLWNhbm5vdC1lZGl0LTEyMw", "nonce": "bm9uY2UtYm9i"},
        cookies=_cookies(bob),
    )
    assert denied.status_code == 403

    edited = await client.patch(
        f"/api/v1/messages/{message_id}",
        json={"ciphertext": "YWxpY2UtZWRpdGVkLWNpcGhlcg", "nonce": "bm9uY2UtYWxpY2U"},
        cookies=_cookies(alice),
    )
    assert edited.status_code == 200
    assert edited.json()["ciphertext"] == "YWxpY2UtZWRpdGVkLWNpcGhlcg"
    assert edited.json()["edited_at"] is not None

    denied_delete = await client.delete(f"/api/v1/messages/{message_id}", cookies=_cookies(bob))
    assert denied_delete.status_code == 403

    deleted = await client.delete(f"/api/v1/messages/{message_id}", cookies=_cookies(alice))
    assert deleted.status_code == 200
    assert deleted.json()["is_deleted"] is True
    assert deleted.json()["ciphertext"] == "__deleted__"


@pytest.mark.asyncio
async def test_forward_message_to_another_room(client: AsyncClient, db_session: AsyncSession):
    alice = await create_test_user(db_session, "alice_forward")
    bob = await create_test_user(db_session, "bob_forward")
    eve = await create_test_user(db_session, "eve_forward")

    source_room = (
        await client.post(
            "/api/v1/rooms",
            json={"type": "direct", "member_ids": [str(bob.id)]},
            cookies=_cookies(alice),
        )
    ).json()["id"]
    target_room = (
        await client.post(
            "/api/v1/rooms",
            json={"type": "direct", "member_ids": [str(eve.id)]},
            cookies=_cookies(alice),
        )
    ).json()["id"]
    source_msg = (
        await client.post(
            f"/api/v1/rooms/{source_room}/messages",
            json={"ciphertext": "Zm9yd2FyZC1zb3VyY2UtY2lwaGVy", "nonce": "bm9uY2UtZnJvbQ"},
            cookies=_cookies(alice),
        )
    ).json()

    forwarded = await client.post(
        f"/api/v1/messages/{source_msg['id']}/forward",
        json={
            "target_room_id": target_room,
            "payload": {
                "ciphertext": "Zm9yd2FyZGVkLXRhcmdldC1jaXBoZXI",
                "nonce": "bm9uY2UtdGFyZ2V0",
            },
        },
        cookies=_cookies(alice),
    )

    assert forwarded.status_code == 201
    body = forwarded.json()
    assert body["room_id"] == target_room
    assert body["forwarded_from_message_id"] == source_msg["id"]


@pytest.mark.asyncio
async def test_upload_image_attachment_and_download_encrypted_blob(
    client: AsyncClient,
    db_session: AsyncSession,
    tmp_path,
    monkeypatch,
):
    monkeypatch.setattr(settings, "ATTACHMENT_STORAGE_DIR", str(tmp_path))
    alice = await create_test_user(db_session, "alice_upload")
    bob = await create_test_user(db_session, "bob_upload")
    room_id = (
        await client.post(
            "/api/v1/rooms",
            json={"type": "direct", "member_ids": [str(bob.id)]},
            cookies=_cookies(alice),
        )
    ).json()["id"]
    encrypted_blob = b"encrypted-image-bytes"

    upload = await client.post(
        f"/api/v1/rooms/{room_id}/attachments",
        files={"file": ("image.gif.encrypted", encrypted_blob, "application/octet-stream")},
        data={"filename": "image.gif", "mime_type": "image/gif", "size_bytes": str(len(encrypted_blob))},
        cookies=_cookies(alice),
    )

    assert upload.status_code == 201
    attachment = upload.json()
    assert attachment["mime_type"] == "image/gif"
    assert attachment["url"].startswith("/api/v1/attachments/")

    send = await client.post(
        f"/api/v1/rooms/{room_id}/messages",
        json={
            "ciphertext": "bWVzc2FnZS13aXRoLWF0dGFjaG1lbnQ",
            "nonce": "bm9uY2UtYXR0",
            "attachment_ids": [attachment["id"]],
        },
        cookies=_cookies(alice),
    )
    assert send.status_code == 201
    assert send.json()["attachments"][0]["id"] == attachment["id"]

    downloaded = await client.get(attachment["url"], cookies=_cookies(bob))
    assert downloaded.status_code == 200
    assert downloaded.content == encrypted_blob
