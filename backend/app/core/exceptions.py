"""
Centralized exception hierarchy.
All domain errors inherit from AppError so they can be caught uniformly.
"""

from __future__ import annotations

from fastapi import HTTPException, status


class AppError(Exception):
    """Base for all application errors."""

    status_code: int = status.HTTP_500_INTERNAL_SERVER_ERROR
    detail: str = "An unexpected error occurred"

    def __init__(self, detail: str | None = None) -> None:
        self.detail = detail or self.__class__.detail
        super().__init__(self.detail)

    def as_http_exception(self) -> HTTPException:
        return HTTPException(status_code=self.status_code, detail=self.detail)


# ── Auth ──────────────────────────────────────────────────────────────────────


class AuthenticationError(AppError):
    status_code = status.HTTP_401_UNAUTHORIZED
    detail = "Authentication required"


class InvalidCredentialsError(AppError):
    status_code = status.HTTP_401_UNAUTHORIZED
    detail = "Invalid credentials"


class SessionExpiredError(AppError):
    status_code = status.HTTP_401_UNAUTHORIZED
    detail = "Session expired — please log in again"


class WebAuthnError(AppError):
    status_code = status.HTTP_400_BAD_REQUEST
    detail = "WebAuthn operation failed"


# ── Authorization ─────────────────────────────────────────────────────────────


class ForbiddenError(AppError):
    status_code = status.HTTP_403_FORBIDDEN
    detail = "You do not have permission to perform this action"


# ── Resource ──────────────────────────────────────────────────────────────────


class NotFoundError(AppError):
    status_code = status.HTTP_404_NOT_FOUND
    detail = "Resource not found"


class UserNotFoundError(NotFoundError):
    detail = "User not found"


class RoomNotFoundError(NotFoundError):
    detail = "Room not found"


class MessageNotFoundError(NotFoundError):
    detail = "Message not found"


# ── Conflict ──────────────────────────────────────────────────────────────────


class ConflictError(AppError):
    status_code = status.HTTP_409_CONFLICT
    detail = "Resource already exists"


class UsernameConflictError(ConflictError):
    detail = "Username already taken"


# ── Keys ──────────────────────────────────────────────────────────────────────


class KeyError(AppError):
    status_code = status.HTTP_400_BAD_REQUEST
    detail = "Key operation failed"


class NoPrekeysAvailableError(KeyError):
    detail = "No one-time prekeys available — fallback to signed prekey only"


# ── Rate Limit ────────────────────────────────────────────────────────────────


class RateLimitError(AppError):
    status_code = status.HTTP_429_TOO_MANY_REQUESTS
    detail = "Too many requests — please slow down"


# ── Validation ────────────────────────────────────────────────────────────────


class ValidationError(AppError):
    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    detail = "Validation error"


# ── WebSocket ─────────────────────────────────────────────────────────────────


class WebSocketAuthError(AppError):
    status_code = status.HTTP_403_FORBIDDEN
    detail = "WebSocket authentication failed"
