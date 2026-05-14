import pytest
from httpx import AsyncClient

import app.services.auth_service as auth_service_module
from app.core.config import settings
from app.repositories.user_repository import UserRepository


class _VerifiedAuthentication:
    credential_id = b"credential-id"
    new_sign_count = 2


class _VerifiedRegistration:
    credential_id = b"new-credential-id"
    credential_public_key = b"new-credential-public-key"
    sign_count = 0


class _DummyPasskeyManager:
    rp_id = "localhost"
    origin = ["http://localhost", "http://localhost:5173"]

    def generate_authentication_options(self, credentials):
        assert credentials
        return {"challenge": "client-challenge", "allowCredentials": []}, "auth-challenge"

    def verify_authentication(self, **kwargs):
        assert kwargs["expected_challenge_b64"] == "auth-challenge"
        assert kwargs["stored_public_key"] == b"credential-public-key"
        assert kwargs["stored_sign_count"] == 1
        return _VerifiedAuthentication()

    def generate_registration_options(
        self,
        user_id,
        username,
        display_name,
        existing_credentials=None,
    ):
        return {
            "challenge": "client-passkey-challenge",
            "user": {"id": str(user_id), "name": username, "displayName": display_name},
            "excludeCredentials": [],
        }, "passkey-challenge"

    def verify_registration(self, credential_raw, expected_challenge_b64):
        assert expected_challenge_b64 == "passkey-challenge"
        return _VerifiedRegistration()


@pytest.mark.asyncio
async def test_login_success_sets_session_and_auth_me_works(
    client: AsyncClient,
    db_session,
    monkeypatch,
):
    monkeypatch.setattr(settings, "COOKIE_SECURE", False)
    monkeypatch.setattr(auth_service_module, "passkey_manager", _DummyPasskeyManager())

    repo = UserRepository(db_session)
    user = await repo.create("alice_login", "Alice")
    await repo.add_credential(
        user_id=user.id,
        credential_id=b"credential-id",
        public_key=b"credential-public-key",
        sign_count=1,
        transports=None,
    )
    await db_session.commit()

    options = await client.post(
        "/api/v1/auth/login/options",
        json={"username": "alice_login"},
    )
    assert options.status_code == 200

    verify = await client.post(
        "/api/v1/auth/login/verify",
        json={
            "username": "alice_login",
            "credential": {
                "id": "Y3JlZGVudGlhbC1pZA",
                "rawId": "Y3JlZGVudGlhbC1pZA",
                "type": "public-key",
                "response": {"userHandle": None},
            },
        },
    )

    assert verify.status_code == 200
    assert verify.json()["user"]["id"] == str(user.id)
    assert settings.SESSION_COOKIE_NAME in verify.cookies

    me = await client.get("/api/v1/auth/me")
    assert me.status_code == 200
    assert me.json()["username"] == "alice_login"


@pytest.mark.asyncio
async def test_login_options_missing_user_returns_401(client: AsyncClient):
    response = await client.post(
        "/api/v1/auth/login/options",
        json={"username": "missing_login_user"},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid username or passkey"


@pytest.mark.asyncio
async def test_login_verify_missing_challenge_returns_400(
    client: AsyncClient,
    db_session,
):
    repo = UserRepository(db_session)
    await repo.create("alice_no_challenge", "Alice")
    await db_session.commit()

    response = await client.post(
        "/api/v1/auth/login/verify",
        json={
            "username": "alice_no_challenge",
            "credential": {
                "id": "Y3JlZGVudGlhbC1pZA",
                "rawId": "Y3JlZGVudGlhbC1pZA",
                "type": "public-key",
                "response": {"userHandle": None},
            },
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Challenge expired — please try again"


@pytest.mark.asyncio
async def test_login_verify_unknown_credential_returns_401(
    client: AsyncClient,
    db_session,
    monkeypatch,
):
    monkeypatch.setattr(auth_service_module, "passkey_manager", _DummyPasskeyManager())
    monkeypatch.setattr(settings, "COOKIE_SECURE", False)

    repo = UserRepository(db_session)
    user = await repo.create("alice_bad_credential", "Alice")
    await repo.add_credential(
        user_id=user.id,
        credential_id=b"credential-id",
        public_key=b"credential-public-key",
        sign_count=1,
        transports=None,
    )
    await db_session.commit()

    options = await client.post(
        "/api/v1/auth/login/options",
        json={"username": "alice_bad_credential"},
    )
    assert options.status_code == 200

    response = await client.post(
        "/api/v1/auth/login/verify",
        json={
            "username": "alice_bad_credential",
            "credential": {
                "id": "b3RoZXItY3JlZGVudGlhbA",
                "rawId": "b3RoZXItY3JlZGVudGlhbA",
                "type": "public-key",
                "response": {"userHandle": None},
            },
        },
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Credential not found for user"


@pytest.mark.asyncio
async def test_user_cannot_login_with_another_users_credential(
    client: AsyncClient,
    db_session,
    monkeypatch,
):
    monkeypatch.setattr(auth_service_module, "passkey_manager", _DummyPasskeyManager())
    monkeypatch.setattr(settings, "COOKIE_SECURE", False)

    repo = UserRepository(db_session)
    alice = await repo.create("alice_wrong_passkey", "Alice")
    bob = await repo.create("bob_wrong_passkey", "Bob")
    await repo.add_credential(
        user_id=alice.id,
        credential_id=b"credential-id",
        public_key=b"credential-public-key",
        sign_count=1,
        transports=None,
    )
    await repo.add_credential(
        user_id=bob.id,
        credential_id=b"bob-credential-id",
        public_key=b"bob-credential-public-key",
        sign_count=1,
        transports=None,
    )
    await db_session.commit()

    options = await client.post(
        "/api/v1/auth/login/options",
        json={"username": "bob_wrong_passkey"},
    )
    assert options.status_code == 200

    response = await client.post(
        "/api/v1/auth/login/verify",
        json={
            "username": "bob_wrong_passkey",
            "credential": {
                "id": "Y3JlZGVudGlhbC1pZA",
                "rawId": "Y3JlZGVudGlhbC1pZA",
                "type": "public-key",
                "response": {"userHandle": None},
            },
        },
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Credential not found for user"


@pytest.mark.asyncio
async def test_authenticated_user_can_add_list_and_delete_extra_passkey(
    client: AsyncClient,
    db_session,
    monkeypatch,
):
    monkeypatch.setattr(auth_service_module, "passkey_manager", _DummyPasskeyManager())
    monkeypatch.setattr(settings, "COOKIE_SECURE", False)

    repo = UserRepository(db_session)
    user = await repo.create("alice_extra_passkey", "Alice")
    first = await repo.add_credential(
        user_id=user.id,
        credential_id=b"credential-id",
        public_key=b"credential-public-key",
        sign_count=1,
        transports=None,
    )
    await db_session.commit()

    login = await client.post(
        "/api/v1/auth/login/options",
        json={"username": "alice_extra_passkey"},
    )
    assert login.status_code == 200
    verified = await client.post(
        "/api/v1/auth/login/verify",
        json={
            "username": "alice_extra_passkey",
            "credential": {
                "id": "Y3JlZGVudGlhbC1pZA",
                "rawId": "Y3JlZGVudGlhbC1pZA",
                "type": "public-key",
                "response": {"userHandle": None},
            },
        },
    )
    assert verified.status_code == 200

    options = await client.post("/api/v1/auth/passkeys/options")
    assert options.status_code == 200

    added = await client.post(
        "/api/v1/auth/passkeys/verify",
        json={"credential": {"response": {"transports": ["internal"]}}},
    )
    assert added.status_code == 201
    added_id = added.json()["id"]

    listed = await client.get("/api/v1/auth/passkeys")
    assert listed.status_code == 200
    assert len(listed.json()) == 2

    deleted = await client.delete(f"/api/v1/auth/passkeys/{added_id}")
    assert deleted.status_code == 204

    denied = await client.delete(f"/api/v1/auth/passkeys/{first.id}")
    assert denied.status_code == 403
