import json
import uuid

import pytest
from webauthn.helpers import bytes_to_base64url

import app.services.auth_service as auth_service_module
from app.core.exceptions import AuthenticationError
from app.repositories.user_repository import UserRepository
from app.services.auth_service import AuthService


class _VerifiedRegistration:
    credential_id = b"credential-id"
    credential_public_key = b"credential-public-key"
    sign_count = 7


class _DummyPasskeyManager:
    rp_id = "localhost"
    origin = "http://localhost:5173"

    def generate_registration_options(self, user_id, username, display_name):
        return {"challenge": "client-challenge", "user": {"id": str(user_id)}}, "reg-challenge"

    def verify_registration(self, credential_raw, expected_challenge_b64):
        assert expected_challenge_b64 == "reg-challenge"
        return _VerifiedRegistration()

    def generate_authentication_options(self, credentials):
        assert credentials == [b"credential-id"]
        return {"challenge": "client-challenge", "allowCredentials": []}, "auth-challenge"

    def verify_authentication(self, **kwargs):
        raise AssertionError("user-handle mismatch should fail before cryptographic verification")


@pytest.mark.asyncio
async def test_registration_challenge_user_id_becomes_user_handle(
    db_session,
    fake_redis,
    monkeypatch,
):
    dummy = _DummyPasskeyManager()
    monkeypatch.setattr(auth_service_module, "passkey_manager", dummy)

    repo = UserRepository(db_session)
    svc = AuthService(repo, fake_redis)

    await svc.begin_registration("alice_passkey", "Alice")
    raw = await fake_redis.get("webauthn_challenge:reg:alice_passkey")
    record = json.loads(raw.decode("utf-8") if isinstance(raw, bytes) else raw)
    expected_user_id = uuid.UUID(record["user_id"])

    user = await svc.complete_registration(
        username="alice_passkey",
        display_name="Alice",
        credential_raw={"response": {"transports": ["internal"]}},
    )

    assert user.id == expected_user_id
    assert await fake_redis.get("webauthn_challenge:reg:alice_passkey") is None

    credentials = await repo.get_credentials_for_user(user.id)
    assert len(credentials) == 1
    assert credentials[0].credential_id == b"credential-id"
    assert credentials[0].public_key == b"credential-public-key"
    assert credentials[0].sign_count == 7
    assert credentials[0].transports == "internal"


@pytest.mark.asyncio
async def test_login_rejects_mismatched_user_handle_and_deletes_challenge(
    db_session,
    fake_redis,
    monkeypatch,
):
    dummy = _DummyPasskeyManager()
    monkeypatch.setattr(auth_service_module, "passkey_manager", dummy)

    repo = UserRepository(db_session)
    svc = AuthService(repo, fake_redis)

    user = await repo.create("bob_passkey", "Bob")
    await repo.add_credential(
        user_id=user.id,
        credential_id=b"credential-id",
        public_key=b"credential-public-key",
        sign_count=0,
        transports=None,
    )

    await svc.begin_login("bob_passkey")
    wrong_user_handle = str(uuid.uuid4()).encode()

    with pytest.raises(AuthenticationError):
        await svc.complete_login(
            username="bob_passkey",
            credential_raw={
                "id": bytes_to_base64url(b"credential-id"),
                "rawId": bytes_to_base64url(b"credential-id"),
                "response": {
                    "userHandle": bytes_to_base64url(wrong_user_handle),
                },
            },
        )

    assert await fake_redis.get("webauthn_challenge:auth:bob_passkey") is None
