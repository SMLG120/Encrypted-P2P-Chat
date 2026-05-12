"""
WebAuthn/Passkey manager.

Uses the 'webauthn' package (py_webauthn) which implements the W3C spec
and is the most maintained Python WebAuthn library.
"""

from __future__ import annotations

import base64
import json
import uuid
from typing import Any

import webauthn
from webauthn.helpers import bytes_to_base64url, base64url_to_bytes
from webauthn.helpers.structs import (
    AuthenticationCredential,
    PublicKeyCredentialDescriptor,
    RegistrationCredential,
    UserVerificationRequirement,
)

from app.core.config import settings
from app.core.exceptions import WebAuthnError
from app.core.logging import get_logger

log = get_logger(__name__)


class PasskeyManager:
    """
    Wraps py_webauthn to provide registration and authentication helpers.
    Challenges are stored in Redis with a TTL (see auth_service).
    """

    def __init__(self) -> None:
        self.rp_id = settings.WEBAUTHN_RP_ID
        self.rp_name = settings.WEBAUTHN_RP_NAME
        self.origin = settings.WEBAUTHN_ORIGIN

    def generate_registration_options(
        self,
        user_id: uuid.UUID,
        username: str,
        display_name: str,
        existing_credentials: list[bytes] | None = None,
    ) -> tuple[Any, str]:
        """
        Returns (options_dict, challenge_b64url).
        challenge_b64url is stored in Redis and verified later.
        """
        options = webauthn.generate_registration_options(
            rp_id=self.rp_id,
            rp_name=self.rp_name,
            user_id=str(user_id).encode(),
            user_name=username,
            user_display_name=display_name,
            exclude_credentials=[
                PublicKeyCredentialDescriptor(id=c) for c in (existing_credentials or [])
            ],
            authenticator_selection=webauthn.helpers.structs.AuthenticatorSelectionCriteria(
                user_verification=UserVerificationRequirement.REQUIRED,
                resident_key=webauthn.helpers.structs.ResidentKeyRequirement.PREFERRED,
            ),
        )
        challenge_b64 = bytes_to_base64url(options.challenge)
        options_dict = webauthn.options_to_json(options)
        return json.loads(options_dict), challenge_b64

    def verify_registration(
        self,
        credential_raw: dict[str, Any],
        expected_challenge_b64: str,
    ) -> webauthn.helpers.structs.VerifiedRegistration:
        try:
            credential = RegistrationCredential.parse_raw(json.dumps(credential_raw))
            verification = webauthn.verify_registration_response(
                credential=credential,
                expected_challenge=base64url_to_bytes(expected_challenge_b64),
                expected_rp_id=self.rp_id,
                expected_origin=self.origin,
                require_user_verification=True,
            )
            return verification
        except Exception as exc:
            log.warning("webauthn_registration_failed", error=str(exc))
            raise WebAuthnError(f"Registration verification failed: {exc}") from exc

    def generate_authentication_options(
        self,
        credentials: list[bytes],
    ) -> tuple[Any, str]:
        options = webauthn.generate_authentication_options(
            rp_id=self.rp_id,
            allow_credentials=[
                PublicKeyCredentialDescriptor(id=c) for c in credentials
            ],
            user_verification=UserVerificationRequirement.REQUIRED,
        )
        challenge_b64 = bytes_to_base64url(options.challenge)
        options_dict = webauthn.options_to_json(options)
        return json.loads(options_dict), challenge_b64

    def verify_authentication(
        self,
        credential_raw: dict[str, Any],
        expected_challenge_b64: str,
        stored_public_key: bytes,
        stored_sign_count: int,
    ) -> webauthn.helpers.structs.VerifiedAuthentication:
        try:
            credential = AuthenticationCredential.parse_raw(json.dumps(credential_raw))
            verification = webauthn.verify_authentication_response(
                credential=credential,
                expected_challenge=base64url_to_bytes(expected_challenge_b64),
                expected_rp_id=self.rp_id,
                expected_origin=self.origin,
                credential_public_key=stored_public_key,
                credential_current_sign_count=stored_sign_count,
                require_user_verification=True,
            )
            return verification
        except Exception as exc:
            log.warning("webauthn_authentication_failed", error=str(exc))
            raise WebAuthnError(f"Authentication verification failed: {exc}") from exc


passkey_manager = PasskeyManager()
