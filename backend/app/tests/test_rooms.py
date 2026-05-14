import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.tests.conftest import create_test_user, make_session_cookie


def _cookies(user):
    return {settings.SESSION_COOKIE_NAME: make_session_cookie(user.id)}


@pytest.mark.asyncio
async def test_direct_room_response_includes_both_members(
    client: AsyncClient,
    db_session: AsyncSession,
):
    alice = await create_test_user(db_session, "alice_room")
    bob = await create_test_user(db_session, "bob_room")

    response = await client.post(
        "/api/v1/rooms",
        json={"type": "direct", "member_ids": [str(bob.id)]},
        cookies=_cookies(alice),
    )

    assert response.status_code == 201
    body = response.json()
    member_ids = {member["user_id"] for member in body["members"]}
    assert member_ids == {str(alice.id), str(bob.id)}
    assert all(member["user"] for member in body["members"])


@pytest.mark.asyncio
async def test_direct_room_rejects_unknown_user(
    client: AsyncClient,
    db_session: AsyncSession,
):
    alice = await create_test_user(db_session, "alice_unknown_room")

    response = await client.post(
        "/api/v1/rooms",
        json={"type": "direct", "member_ids": [str(uuid.uuid4())]},
        cookies=_cookies(alice),
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "User not found"
