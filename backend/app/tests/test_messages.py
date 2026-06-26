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
async def test_cannot_send_private_key_or_ratchet_state_fields(
    client: AsyncClient,
    db_session: AsyncSession,
):
    alice = await create_test_user(db_session, "alice_key_leak")
    bob = await create_test_user(db_session, "bob_key_leak")

    resp = await client.post(
        "/api/v1/rooms",
        json={"type": "direct", "member_ids": [str(bob.id)]},
        cookies=_cookies(alice),
    )
    room_id = resp.json()["id"]

    resp2 = await client.post(
        f"/api/v1/rooms/{room_id}/messages",
        json={
            "recipient_id": str(bob.id),
            "ciphertext": "ZW5jcnlwdGVkLXBheWxvYWQtb25seQ",
            "nonce": "bm9uY2Uta2V5LWxlYWs",
            "private_key": "must-never-cross-the-network",
            "ratchet_state": {"chain_key": "also-forbidden"},
        },
        cookies=_cookies(alice),
    )

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
async def test_group_messages_are_per_recipient_ciphertext(
    client: AsyncClient,
    db_session: AsyncSession,
):
    alice = await create_test_user(db_session, "alice_group_msg")
    bob = await create_test_user(db_session, "bob_group_msg")
    carol = await create_test_user(db_session, "carol_group_msg")

    room = (
        await client.post(
            "/api/v1/rooms/group",
            json={"name": "Cipher Group", "member_ids": [str(bob.id), str(carol.id)]},
            cookies=_cookies(alice),
        )
    ).json()

    bob_payload = {
        "recipient_id": str(bob.id),
        "ciphertext": "Ym9iLWdyb3VwLWNpcGhlcnRleHQ",
        "encrypted_header": "Ym9iLWdyb3VwLWhlYWRlcg",
        "nonce": "Ym9iLWdyb3VwLW5vbmNl",
    }
    carol_payload = {
        "recipient_id": str(carol.id),
        "ciphertext": "Y2Fyb2wtZ3JvdXAtY2lwaGVydGV4dA",
        "encrypted_header": "Y2Fyb2wtZ3JvdXAtaGVhZGVy",
        "nonce": "Y2Fyb2wtZ3JvdXAtbm9uY2U",
    }

    assert (
        await client.post(
            f"/api/v1/rooms/{room['id']}/messages",
            json=bob_payload,
            cookies=_cookies(alice),
        )
    ).status_code == 201
    assert (
        await client.post(
            f"/api/v1/rooms/{room['id']}/messages",
            json=carol_payload,
            cookies=_cookies(alice),
        )
    ).status_code == 201

    bob_history = await client.get(f"/api/v1/rooms/{room['id']}/messages", cookies=_cookies(bob))
    carol_history = await client.get(f"/api/v1/rooms/{room['id']}/messages", cookies=_cookies(carol))

    assert [msg["ciphertext"] for msg in bob_history.json()["messages"]] == [bob_payload["ciphertext"]]
    assert [msg["ciphertext"] for msg in carol_history.json()["messages"]] == [carol_payload["ciphertext"]]


@pytest.mark.asyncio
async def test_group_message_requires_recipient_and_membership(
    client: AsyncClient,
    db_session: AsyncSession,
):
    alice = await create_test_user(db_session, "alice_group_require")
    bob = await create_test_user(db_session, "bob_group_require")
    eve = await create_test_user(db_session, "eve_group_require")

    room = (
        await client.post(
            "/api/v1/rooms/group",
            json={"name": "Private Group", "member_ids": [str(bob.id)]},
            cookies=_cookies(alice),
        )
    ).json()

    missing_recipient = await client.post(
        f"/api/v1/rooms/{room['id']}/messages",
        json={"ciphertext": "Z3JvdXAtY2lwaGVy", "nonce": "Z3JvdXAtbm9uY2U"},
        cookies=_cookies(alice),
    )
    assert missing_recipient.status_code == 422

    non_member_recipient = await client.post(
        f"/api/v1/rooms/{room['id']}/messages",
        json={
            "recipient_id": str(eve.id),
            "ciphertext": "Z3JvdXAtY2lwaGVyMg",
            "nonce": "Z3JvdXAtbm9uY2Uy",
        },
        cookies=_cookies(alice),
    )
    assert non_member_recipient.status_code == 403


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


@pytest.mark.asyncio
async def test_group_attachment_can_be_sent_to_each_recipient(
    client: AsyncClient,
    db_session: AsyncSession,
    tmp_path,
    monkeypatch,
):
    monkeypatch.setattr(settings, "ATTACHMENT_STORAGE_DIR", str(tmp_path))
    alice = await create_test_user(db_session, "alice_group_upload")
    bob = await create_test_user(db_session, "bob_group_upload")
    carol = await create_test_user(db_session, "carol_group_upload")

    room = (
        await client.post(
            "/api/v1/rooms/group",
            json={"name": "Attachment Group", "member_ids": [str(bob.id), str(carol.id)]},
            cookies=_cookies(alice),
        )
    ).json()
    encrypted_blob = b"encrypted-group-image-bytes"

    upload = await client.post(
        f"/api/v1/rooms/{room['id']}/attachments",
        files={"file": ("group.png.encrypted", encrypted_blob, "application/octet-stream")},
        data={"filename": "group.png", "mime_type": "image/png", "size_bytes": str(len(encrypted_blob))},
        cookies=_cookies(alice),
    )
    assert upload.status_code == 201
    attachment = upload.json()

    for recipient, ciphertext in (
        (bob, "Ym9iLWdyb3VwLWF0dGFjaG1lbnQ"),
        (carol, "Y2Fyb2wtZ3JvdXAtYXR0YWNobWVudA"),
    ):
        sent = await client.post(
            f"/api/v1/rooms/{room['id']}/messages",
            json={
                "recipient_id": str(recipient.id),
                "ciphertext": ciphertext,
                "encrypted_header": "Z3JvdXAtYXR0YWNobWVudC1oZWFkZXI",
                "nonce": "Z3JvdXAtYXR0YWNobWVudC1ub25jZQ",
                "attachment_ids": [attachment["id"]],
            },
            cookies=_cookies(alice),
        )
        assert sent.status_code == 201

        downloaded = await client.get(attachment["url"], cookies=_cookies(recipient))
        assert downloaded.status_code == 200
        assert downloaded.content == encrypted_blob

    # Regression: the attachment must stay linked to EVERY recipient's
    # message row after a reload, not just the first one that claimed it.
    history = await client.get(f"/api/v1/rooms/{room['id']}/messages", cookies=_cookies(bob))
    assert history.status_code == 200
    bob_messages = [m for m in history.json()["messages"] if m["recipient_id"] == str(bob.id)]
    assert len(bob_messages) == 1
    assert bob_messages[0]["attachments"][0]["id"] == attachment["id"]

    history_carol = await client.get(f"/api/v1/rooms/{room['id']}/messages", cookies=_cookies(carol))
    carol_messages = [m for m in history_carol.json()["messages"] if m["recipient_id"] == str(carol.id)]
    assert len(carol_messages) == 1
    assert carol_messages[0]["attachments"][0]["id"] == attachment["id"]


@pytest.mark.asyncio
async def test_direct_text_only_message(client: AsyncClient, db_session: AsyncSession):
    alice = await create_test_user(db_session, "alice_text_only")
    bob = await create_test_user(db_session, "bob_text_only")
    room_id = (
        await client.post(
            "/api/v1/rooms",
            json={"type": "direct", "member_ids": [str(bob.id)]},
            cookies=_cookies(alice),
        )
    ).json()["id"]

    sent = await client.post(
        f"/api/v1/rooms/{room_id}/messages",
        json={"ciphertext": "dGV4dC1vbmx5LWNpcGhlcnRleHQ", "nonce": "dGV4dC1vbmx5LW5vbmNl"},
        cookies=_cookies(alice),
    )
    assert sent.status_code == 201
    assert sent.json()["attachments"] == []


@pytest.mark.asyncio
async def test_direct_file_only_message(
    client: AsyncClient, db_session: AsyncSession, tmp_path, monkeypatch
):
    monkeypatch.setattr(settings, "ATTACHMENT_STORAGE_DIR", str(tmp_path))
    alice = await create_test_user(db_session, "alice_file_only")
    bob = await create_test_user(db_session, "bob_file_only")
    room_id = (
        await client.post(
            "/api/v1/rooms",
            json={"type": "direct", "member_ids": [str(bob.id)]},
            cookies=_cookies(alice),
        )
    ).json()["id"]
    encrypted_blob = b"file-only-encrypted-bytes"

    upload = await client.post(
        f"/api/v1/rooms/{room_id}/attachments",
        files={"file": ("file.png.encrypted", encrypted_blob, "application/octet-stream")},
        data={"filename": "file.png", "mime_type": "image/png", "size_bytes": str(len(encrypted_blob))},
        cookies=_cookies(alice),
    )
    assert upload.status_code == 201
    attachment = upload.json()

    # File-only message: client still encrypts an empty-text envelope, so
    # ciphertext is non-empty even though there is no user-visible text.
    sent = await client.post(
        f"/api/v1/rooms/{room_id}/messages",
        json={
            "ciphertext": "ZmlsZS1vbmx5LWVudmVsb3BlLWNpcGhlcnRleHQ",
            "nonce": "ZmlsZS1vbmx5LW5vbmNl",
            "attachment_ids": [attachment["id"]],
        },
        cookies=_cookies(alice),
    )
    assert sent.status_code == 201
    assert sent.json()["attachments"][0]["id"] == attachment["id"]


@pytest.mark.asyncio
async def test_direct_text_and_attachment_persists_after_reload(
    client: AsyncClient, db_session: AsyncSession, tmp_path, monkeypatch
):
    monkeypatch.setattr(settings, "ATTACHMENT_STORAGE_DIR", str(tmp_path))
    alice = await create_test_user(db_session, "alice_text_file")
    bob = await create_test_user(db_session, "bob_text_file")
    room_id = (
        await client.post(
            "/api/v1/rooms",
            json={"type": "direct", "member_ids": [str(bob.id)]},
            cookies=_cookies(alice),
        )
    ).json()["id"]
    encrypted_blob = b"text-and-file-encrypted-bytes"

    upload = await client.post(
        f"/api/v1/rooms/{room_id}/attachments",
        files={"file": ("note.png.encrypted", encrypted_blob, "application/octet-stream")},
        data={"filename": "note.png", "mime_type": "image/png", "size_bytes": str(len(encrypted_blob))},
        cookies=_cookies(alice),
    )
    assert upload.status_code == 201
    attachment = upload.json()

    sent = await client.post(
        f"/api/v1/rooms/{room_id}/messages",
        json={
            "ciphertext": "dGV4dC1hbmQtZmlsZS1jaXBoZXJ0ZXh0",
            "encrypted_header": "dGV4dC1hbmQtZmlsZS1oZWFkZXI",
            "nonce": "dGV4dC1hbmQtZmlsZS1ub25jZQ",
            "attachment_ids": [attachment["id"]],
        },
        cookies=_cookies(alice),
    )
    assert sent.status_code == 201
    message_id = sent.json()["id"]
    assert sent.json()["attachments"][0]["id"] == attachment["id"]

    # Reload from the DB (not the in-request response) to make sure the
    # link survives — this is the persistence path that previously broke.
    history = await client.get(f"/api/v1/rooms/{room_id}/messages", cookies=_cookies(bob))
    reloaded = next(m for m in history.json()["messages"] if m["id"] == message_id)
    assert reloaded["attachments"][0]["id"] == attachment["id"]


@pytest.mark.asyncio
async def test_unrelated_user_cannot_download_attachment(
    client: AsyncClient, db_session: AsyncSession, tmp_path, monkeypatch
):
    monkeypatch.setattr(settings, "ATTACHMENT_STORAGE_DIR", str(tmp_path))
    alice = await create_test_user(db_session, "alice_unrelated")
    bob = await create_test_user(db_session, "bob_unrelated")
    mallory = await create_test_user(db_session, "mallory_unrelated")
    room_id = (
        await client.post(
            "/api/v1/rooms",
            json={"type": "direct", "member_ids": [str(bob.id)]},
            cookies=_cookies(alice),
        )
    ).json()["id"]
    encrypted_blob = b"unrelated-user-test-bytes"

    upload = await client.post(
        f"/api/v1/rooms/{room_id}/attachments",
        files={"file": ("secret.png.encrypted", encrypted_blob, "application/octet-stream")},
        data={"filename": "secret.png", "mime_type": "image/png", "size_bytes": str(len(encrypted_blob))},
        cookies=_cookies(alice),
    )
    assert upload.status_code == 201
    attachment = upload.json()

    denied = await client.get(attachment["url"], cookies=_cookies(mallory))
    assert denied.status_code == 403


@pytest.mark.asyncio
async def test_sender_can_download_own_attachment(
    client: AsyncClient, db_session: AsyncSession, tmp_path, monkeypatch
):
    monkeypatch.setattr(settings, "ATTACHMENT_STORAGE_DIR", str(tmp_path))
    alice = await create_test_user(db_session, "alice_self_dl")
    bob = await create_test_user(db_session, "bob_self_dl")
    room_id = (
        await client.post(
            "/api/v1/rooms",
            json={"type": "direct", "member_ids": [str(bob.id)]},
            cookies=_cookies(alice),
        )
    ).json()["id"]
    encrypted_blob = b"sender-self-download-bytes"

    upload = await client.post(
        f"/api/v1/rooms/{room_id}/attachments",
        files={"file": ("self.png.encrypted", encrypted_blob, "application/octet-stream")},
        data={"filename": "self.png", "mime_type": "image/png", "size_bytes": str(len(encrypted_blob))},
        cookies=_cookies(alice),
    )
    assert upload.status_code == 201
    attachment = upload.json()

    downloaded = await client.get(attachment["url"], cookies=_cookies(alice))
    assert downloaded.status_code == 200
    assert downloaded.content == encrypted_blob


@pytest.mark.asyncio
async def test_download_nonexistent_attachment_returns_404(
    client: AsyncClient, db_session: AsyncSession
):
    alice = await create_test_user(db_session, "alice_404")
    missing_id = uuid.uuid4()

    resp = await client.get(f"/api/v1/attachments/{missing_id}/blob", cookies=_cookies(alice))
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_download_missing_blob_returns_410(
    client: AsyncClient, db_session: AsyncSession, tmp_path, monkeypatch
):
    """Row exists and the caller is authorized, but the encrypted file
    itself has been removed from storage (e.g. evicted from disk) — this
    must be distinguishable from "never existed" (404) or "not yours" (403)."""
    monkeypatch.setattr(settings, "ATTACHMENT_STORAGE_DIR", str(tmp_path))
    alice = await create_test_user(db_session, "alice_410")
    bob = await create_test_user(db_session, "bob_410")
    room_id = (
        await client.post(
            "/api/v1/rooms",
            json={"type": "direct", "member_ids": [str(bob.id)]},
            cookies=_cookies(alice),
        )
    ).json()["id"]
    encrypted_blob = b"will-be-deleted-from-disk"

    upload = await client.post(
        f"/api/v1/rooms/{room_id}/attachments",
        files={"file": ("gone.png.encrypted", encrypted_blob, "application/octet-stream")},
        data={"filename": "gone.png", "mime_type": "image/png", "size_bytes": str(len(encrypted_blob))},
        cookies=_cookies(alice),
    )
    assert upload.status_code == 201
    attachment = upload.json()

    # Simulate the blob disappearing from disk after the row was created.
    for path in tmp_path.iterdir():
        path.unlink()

    resp = await client.get(attachment["url"], cookies=_cookies(bob))
    assert resp.status_code == 410
