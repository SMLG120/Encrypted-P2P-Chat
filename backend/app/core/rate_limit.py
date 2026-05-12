"""
Rate limiting using slowapi (Starlette-compatible AIOHTTP limiter).
Different endpoints have different limits — auth is most restrictive.
"""

from __future__ import annotations

from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.core.config import settings


def _get_user_or_ip(request: Request) -> str:
    """Use user ID when authenticated, IP otherwise."""
    user = getattr(request.state, "user", None)
    if user:
        return str(user.id)
    return get_remote_address(request)


limiter = Limiter(key_func=_get_user_or_ip, default_limits=["200/minute"])
