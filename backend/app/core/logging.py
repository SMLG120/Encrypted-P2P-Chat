"""
Structured logging configuration using structlog.

SECURITY: This module must NEVER log:
- Plaintext messages or decrypted content
- Private keys or key material
- Session tokens or cookies
- WebAuthn challenge bytes (raw)
- Password hashes or credential secrets
"""

from __future__ import annotations

import logging
import sys
from typing import Any

import structlog
from structlog.types import EventDict, WrappedLogger

from app.core.config import settings

# Fields that must never appear in logs
_FORBIDDEN_FIELDS = frozenset(
    {
        "password",
        "private_key",
        "secret_key",
        "session_token",
        "cookie",
        "plaintext",
        "decrypted",
        "key_material",
        "challenge_bytes",
    }
)


def _scrub_forbidden(
    logger: WrappedLogger, method: str, event_dict: EventDict
) -> EventDict:
    """Processor: remove any fields that must not be logged."""
    for field in list(event_dict.keys()):
        if field.lower() in _FORBIDDEN_FIELDS:
            event_dict[field] = "[REDACTED]"
    return event_dict


def _add_service_context(
    logger: WrappedLogger, method: str, event_dict: EventDict
) -> EventDict:
    event_dict.setdefault("service", settings.APP_NAME)
    event_dict.setdefault("environment", settings.ENVIRONMENT)
    return event_dict


def _add_logger_name(
    logger: WrappedLogger, method: str, event_dict: EventDict
) -> EventDict:
    logger_name = getattr(logger, "name", None)
    if logger_name:
        event_dict.setdefault("logger", logger_name)
    return event_dict


def configure_logging() -> None:
    """Configure structlog for the application."""
    log_level = logging.DEBUG if settings.DEBUG else logging.INFO

    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=log_level,
    )

    shared_processors: list[Any] = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        _add_logger_name,
        structlog.processors.TimeStamper(fmt="iso"),
        _scrub_forbidden,
        _add_service_context,
    ]

    if settings.is_production:
        # JSON for production log aggregation
        structlog.configure(
            processors=[
                *shared_processors,
                structlog.processors.dict_tracebacks,
                structlog.processors.JSONRenderer(),
            ],
            wrapper_class=structlog.make_filtering_bound_logger(log_level),
            context_class=dict,
            logger_factory=structlog.PrintLoggerFactory(),
            cache_logger_on_first_use=True,
        )
    else:
        # Human-readable for development
        structlog.configure(
            processors=[
                *shared_processors,
                structlog.dev.ConsoleRenderer(colors=True),
            ],
            wrapper_class=structlog.make_filtering_bound_logger(log_level),
            context_class=dict,
            logger_factory=structlog.PrintLoggerFactory(),
            cache_logger_on_first_use=True,
        )


def get_logger(name: str) -> structlog.BoundLogger:
    return structlog.get_logger(name)


# Audit logger for security events
def audit_log(event: str, user_id: str | None = None, **kwargs: Any) -> None:
    """
    Log a security-relevant event.
    kwargs must NOT include sensitive material — enforced by _scrub_forbidden.
    """
    log = get_logger("audit")
    log.info(
        event,
        user_id=str(user_id) if user_id else None,
        audit=True,
        **kwargs,
    )
