"""Re-export all models so Alembic autogenerate can discover them."""

from app.models.base import Base
from app.models.credential import WebAuthnCredential
from app.models.identity_key import IdentityKey
from app.models.membership import Membership
from app.models.message import Message
from app.models.one_time_prekey import OneTimePrekey
from app.models.room import Room
from app.models.signed_prekey import SignedPrekey
from app.models.user import User

__all__ = [
    "Base",
    "User",
    "WebAuthnCredential",
    "IdentityKey",
    "SignedPrekey",
    "OneTimePrekey",
    "Room",
    "Membership",
    "Message",
]
