"""
Application configuration — all settings loaded from environment variables.
Never hardcode secrets. See .env.example for required variables.
"""

from __future__ import annotations

import secrets
from functools import lru_cache
from typing import Literal

from pydantic import PostgresDsn, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── App ───────────────────────────────────────────────────────────────
    APP_NAME: str = "Encrypted P2P Chat"
    APP_VERSION: str = "1.0.0"
    ENVIRONMENT: Literal["development", "staging", "production"] = "development"
    DEBUG: bool = False

    # ── Security ──────────────────────────────────────────────────────────
    SECRET_KEY: str = secrets.token_urlsafe(64)
    SESSION_COOKIE_NAME: str = "session"
    SESSION_MAX_AGE: int = 60 * 60 * 24 * 7  # 7 days
    COOKIE_SECURE: bool = True
    COOKIE_SAMESITE: str = "strict"

    # ── WebAuthn ──────────────────────────────────────────────────────────
    WEBAUTHN_RP_ID: str = "localhost"
    WEBAUTHN_RP_NAME: str = "Encrypted P2P Chat"
    # Default to the Vite dev origin. Docker/production override this via env.
    WEBAUTHN_ORIGIN: list[str] | str = ["http://localhost", "http://localhost:5173"]
    WEBAUTHN_CHALLENGE_TTL: int = 300  # seconds

    # ── Database ──────────────────────────────────────────────────────────
    DATABASE_URL: PostgresDsn = PostgresDsn(
        "postgresql+asyncpg://chat:chatpass@localhost:5432/chatdb"
    )
    DATABASE_POOL_SIZE: int = 10
    DATABASE_MAX_OVERFLOW: int = 20

    # ── Redis ─────────────────────────────────────────────────────────────
    REDIS_URL: str = "redis://localhost:6379/0"
    REDIS_SESSION_DB: int = 0
    REDIS_PRESENCE_DB: int = 1
    REDIS_RATE_LIMIT_DB: int = 2

    # ── CORS ──────────────────────────────────────────────────────────────
    ALLOWED_ORIGINS: list[str] | str = ["http://localhost", "http://localhost:5173"]

    # ── Rate Limiting ─────────────────────────────────────────────────────
    RATE_LIMIT_AUTH: str = "10/minute"
    RATE_LIMIT_MESSAGES: str = "60/minute"
    RATE_LIMIT_SEARCH: str = "30/minute"
    RATE_LIMIT_KEYS: str = "20/minute"

    # ── Prekey Config ─────────────────────────────────────────────────────
    MIN_ONE_TIME_PREKEYS: int = 10
    MAX_ONE_TIME_PREKEYS: int = 100
    SIGNED_PREKEY_ROTATION_DAYS: int = 7

    # ── WebSocket ─────────────────────────────────────────────────────────
    WS_HEARTBEAT_INTERVAL: int = 30
    WS_MAX_CONNECTIONS_PER_USER: int = 5

    # ── Attachments ───────────────────────────────────────────────────────
    ATTACHMENT_STORAGE_DIR: str = "uploads/attachments"
    ATTACHMENT_MAX_BYTES: int = 10 * 1024 * 1024
    ATTACHMENT_ALLOWED_MIME_TYPES: list[str] | str = [
        "image/gif",
        "image/jpeg",
        "image/png",
        "image/webp",
    ]

    @field_validator("ALLOWED_ORIGINS", mode="before")
    @classmethod
    def parse_origins(cls, v: str | list) -> list[str]:
        if isinstance(v, str):
            return [origin.strip() for origin in v.split(",") if origin.strip()]
        return v

    @field_validator("WEBAUTHN_ORIGIN", mode="before")
    @classmethod
    def parse_webauthn_origins(cls, v: str | list) -> list[str]:
        if isinstance(v, str):
            return [origin.strip() for origin in v.split(",") if origin.strip()]
        return v

    @field_validator("ATTACHMENT_ALLOWED_MIME_TYPES", mode="before")
    @classmethod
    def parse_attachment_mime_types(cls, v: str | list) -> list[str]:
        if isinstance(v, str):
            return [mime.strip() for mime in v.split(",") if mime.strip()]
        return v

    @field_validator("DEBUG", mode="before")
    @classmethod
    def parse_debug(cls, v: str | bool) -> bool:
        if isinstance(v, bool):
            return v
        value = v.strip().lower()
        if value in {"1", "true", "yes", "on", "debug", "dev", "development"}:
            return True
        if value in {"0", "false", "no", "off", "release", "prod", "production"}:
            return False
        raise ValueError("DEBUG must be a boolean-like value")

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT == "production"

    @property
    def database_url_str(self) -> str:
        return str(self.DATABASE_URL)


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
