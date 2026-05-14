from webauthn.helpers import bytes_to_base64url

import app.core.passkey_manager as passkey_manager_module
from app.core.passkey_manager import PasskeyManager


class _VerifiedRegistration:
    pass


class _VerifiedAuthentication:
    pass


def test_verify_registration_passes_browser_credential_dict_to_webauthn(monkeypatch):
    manager = PasskeyManager()
    manager.rp_id = "localhost"
    manager.origin = "http://localhost:5173"

    credential_raw = {
        "id": "credential-id",
        "rawId": "credential-id",
        "type": "public-key",
        "response": {
            "clientDataJSON": "client-data",
            "attestationObject": "attestation-object",
        },
    }
    challenge = bytes_to_base64url(b"challenge")
    verified = _VerifiedRegistration()

    def fake_verify_registration_response(**kwargs):
        assert kwargs["credential"] is credential_raw
        assert kwargs["expected_challenge"] == b"challenge"
        assert kwargs["expected_rp_id"] == "localhost"
        assert kwargs["expected_origin"] == "http://localhost:5173"
        assert kwargs["require_user_verification"] is True
        return verified

    monkeypatch.setattr(
        passkey_manager_module.webauthn,
        "verify_registration_response",
        fake_verify_registration_response,
    )

    assert manager.verify_registration(credential_raw, challenge) is verified


def test_verify_authentication_passes_browser_credential_dict_to_webauthn(monkeypatch):
    manager = PasskeyManager()
    manager.rp_id = "localhost"
    manager.origin = "http://localhost:5173"

    credential_raw = {
        "id": "credential-id",
        "rawId": "credential-id",
        "type": "public-key",
        "response": {
            "clientDataJSON": "client-data",
            "authenticatorData": "authenticator-data",
            "signature": "signature",
            "userHandle": None,
        },
    }
    challenge = bytes_to_base64url(b"challenge")
    verified = _VerifiedAuthentication()

    def fake_verify_authentication_response(**kwargs):
        assert kwargs["credential"] is credential_raw
        assert kwargs["expected_challenge"] == b"challenge"
        assert kwargs["expected_rp_id"] == "localhost"
        assert kwargs["expected_origin"] == "http://localhost:5173"
        assert kwargs["credential_public_key"] == b"public-key"
        assert kwargs["credential_current_sign_count"] == 3
        assert kwargs["require_user_verification"] is True
        return verified

    monkeypatch.setattr(
        passkey_manager_module.webauthn,
        "verify_authentication_response",
        fake_verify_authentication_response,
    )

    assert (
        manager.verify_authentication(
            credential_raw=credential_raw,
            expected_challenge_b64=challenge,
            stored_public_key=b"public-key",
            stored_sign_count=3,
        )
        is verified
    )
