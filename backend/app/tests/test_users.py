import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.tests.conftest import create_test_user, make_session_cookie


def _cookies(user):
    return {settings.SESSION_COOKIE_NAME: make_session_cookie(user.id)}


@pytest.mark.asyncio
async def test_user_search_requires_authentication(client: AsyncClient) -> None:
    response = await client.get("/api/v1/users/search?q=ali")

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_user_search_excludes_current_user(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    alice = await create_test_user(db_session, "alice_search")
    bob = await create_test_user(db_session, "bob_search")
    await db_session.commit()

    response = await client.get(
        "/api/v1/users/search?q=search",
        cookies=_cookies(alice),
    )

    assert response.status_code == 200
    body = response.json()
    result_ids = {user["id"] for user in body["users"]}
    assert str(alice.id) not in result_ids
    assert str(bob.id) in result_ids
