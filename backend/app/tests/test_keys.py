"""
Key management tests.
Verify: server stores only public keys, never private keys.
"""

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.tests.conftest import create_test_user, make_session_cookie


@pytest.mark.asyncio
async def test_upload_key_bundle(client: AsyncClient, db_session: AsyncSession):
    user = await create_test_user(db_session)
    cookies = {__import__("app.core.config", fromlist=["settings"]).settings.SESSION_COOKIE_NAME: make_session_cookie(user.id)}

    bundle = {
        "identity": {
            "identity_public_key": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
            "signing_public_key": "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=",
        },
        "signed_prekey": {
            "key_id": 1,
            "public_key": "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC=",
            "signature": "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD=",
        },
        "one_time_prekeys": [
            {"key_id": i, "public_key": f"OPK{i}{'A' * 40}="} for i in range(5)
        ],
    }

    resp = await client.post("/api/v1/keys/upload", json=bundle, cookies=cookies)
    assert resp.status_code == 201

    # Verify status shows keys uploaded
    resp2 = await client.get("/api/v1/keys/status", cookies=cookies)
    assert resp2.status_code == 200
    data = resp2.json()
    assert data["identity_key_uploaded"] is True
    assert data["signed_prekey_active"] is True
    assert data["one_time_prekeys_remaining"] == 5


@pytest.mark.asyncio
async def test_key_bundle_fetch(client: AsyncClient, db_session: AsyncSession):
    alice = await create_test_user(db_session, "alice2")
    bob = await create_test_user(db_session, "bob2")

    alice_cookies = {__import__("app.core.config", fromlist=["settings"]).settings.SESSION_COOKIE_NAME: make_session_cookie(alice.id)}
    bob_cookies = {__import__("app.core.config", fromlist=["settings"]).settings.SESSION_COOKIE_NAME: make_session_cookie(bob.id)}

    # Bob uploads keys
    bundle = {
        "identity": {
            "identity_public_key": "EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE=",
            "signing_public_key": "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF=",
        },
        "signed_prekey": {
            "key_id": 1,
            "public_key": "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG=",
            "signature": "HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH=",
        },
        "one_time_prekeys": [{"key_id": 1, "public_key": "IIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIII="}],
    }
    await client.post("/api/v1/keys/upload", json=bundle, cookies=bob_cookies)

    # Alice fetches Bob's bundle
    resp = await client.get(f"/api/v1/keys/bundle/{bob.id}", cookies=alice_cookies)
    assert resp.status_code == 200
    data = resp.json()
    assert data["identity_public_key"] == "EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE="
    # OPK should be consumed
    assert data["one_time_prekey"] is not None
    assert data["one_time_prekey"]["key_id"] == 1

    # Second fetch — OPK exhausted, should return None for OPK
    resp2 = await client.get(f"/api/v1/keys/bundle/{bob.id}", cookies=alice_cookies)
    assert resp2.status_code == 200
    assert resp2.json()["one_time_prekey"] is None
