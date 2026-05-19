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


@pytest.mark.asyncio
async def test_group_room_creation_add_and_leave(
    client: AsyncClient,
    db_session: AsyncSession,
):
    alice = await create_test_user(db_session, "alice_group")
    bob = await create_test_user(db_session, "bob_group")
    carol = await create_test_user(db_session, "carol_group")

    create = await client.post(
        "/api/v1/rooms/group",
        json={"name": "Incident Room", "member_ids": [str(bob.id)]},
        cookies=_cookies(alice),
    )

    assert create.status_code == 201
    body = create.json()
    assert body["type"] == "group"
    assert body["name"] == "Incident Room"
    assert {member["user_id"] for member in body["members"]} == {str(alice.id), str(bob.id)}

    add = await client.post(
        f"/api/v1/rooms/{body['id']}/members",
        json={"user_id": str(carol.id)},
        cookies=_cookies(alice),
    )
    assert add.status_code == 201

    detail = await client.get(f"/api/v1/rooms/{body['id']}", cookies=_cookies(carol))
    assert detail.status_code == 200
    assert str(carol.id) in {member["user_id"] for member in detail.json()["members"]}

    leave = await client.delete(
        f"/api/v1/rooms/{body['id']}/members/{bob.id}",
        cookies=_cookies(bob),
    )
    assert leave.status_code == 200

    denied = await client.get(f"/api/v1/rooms/{body['id']}", cookies=_cookies(bob))
    assert denied.status_code == 403


@pytest.mark.asyncio
async def test_non_owner_cannot_add_group_member(
    client: AsyncClient,
    db_session: AsyncSession,
):
    alice = await create_test_user(db_session, "alice_group_owner")
    bob = await create_test_user(db_session, "bob_group_member")
    carol = await create_test_user(db_session, "carol_group_denied")

    room = (
        await client.post(
            "/api/v1/rooms/group",
            json={"name": "Ops", "member_ids": [str(bob.id)]},
            cookies=_cookies(alice),
        )
    ).json()

    denied = await client.post(
        f"/api/v1/rooms/{room['id']}/members",
        json={"user_id": str(carol.id)},
        cookies=_cookies(bob),
    )

    assert denied.status_code == 403
