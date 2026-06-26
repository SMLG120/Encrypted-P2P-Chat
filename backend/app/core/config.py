"""
Application configuration — all settings loaded from environment variables.
Never hardcode secrets. See .env.example for required variables.
"""

from __future__ import annotations

import secrets
from functools import lru_cache
from typing import Literal

from pydantic import AliasChoices, Field, PostgresDsn, field_validator, model_validator
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
    API_BACKEND_URL: str = "http://localhost:8000"

    # ── Security ──────────────────────────────────────────────────────────
    SECRET_KEY: str = secrets.token_urlsafe(64)
    SESSION_COOKIE_NAME: str = "session"
    SESSION_MAX_AGE: int = 60 * 60 * 24 * 7  # 7 days
    COOKIE_SECURE: bool = Field(
        default=False,
        validation_alias=AliasChoices("SESSION_COOKIE_SECURE", "COOKIE_SECURE"),
    )
    COOKIE_SAMESITE: str = Field(
        default="lax",
        validation_alias=AliasChoices("SESSION_COOKIE_SAMESITE", "COOKIE_SAMESITE"),
    )

    # ── WebAuthn ──────────────────────────────────────────────────────────
    WEBAUTHN_RP_ID: str = Field(
        default="localhost",
        validation_alias=AliasChoices("RP_ID", "WEBAUTHN_RP_ID"),
    )
    WEBAUTHN_RP_NAME: str = "Encrypted P2P Chat"
    # Default to the Vite dev origin. Docker/production override this via env.
    WEBAUTHN_ORIGIN: list[str] | str = Field(
        default=["http://localhost:5173", "http://localhost"],
        validation_alias=AliasChoices("RP_ORIGIN", "WEBAUTHN_ORIGIN"),
    )
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
    ALLOWED_ORIGINS: list[str] | str = Field(
        default=["http://localhost:5173", "http://localhost"],
        validation_alias=AliasChoices("CORS_ALLOWED_ORIGINS", "ALLOWED_ORIGINS"),
    )

    # ── Rate Limiting ─────────────────────────────────────────────────────
    RATE_LIMIT_AUTH: str = "10/minute"
    RATE_LIMIT_MESSAGES: str = "60/minute"
    RATE_LIMIT_SEARCH: str = "30/minute"
    RATE_LIMIT_KEYS: str = "20/minute"
    RATE_LIMIT_UPLOADS: str = "20/minute"

    # ── Prekey Config ─────────────────────────────────────────────────────
    MIN_ONE_TIME_PREKEYS: int = 10
    MAX_ONE_TIME_PREKEYS: int = 100
    SIGNED_PREKEY_ROTATION_DAYS: int = 7

    # ── WebSocket ─────────────────────────────────────────────────────────
    WS_HEARTBEAT_INTERVAL: int = 30
    WS_MAX_CONNECTIONS_PER_USER: int = 5

    # ── Attachments ───────────────────────────────────────────────────────
    # "local" writes to ATTACHMENT_STORAGE_DIR (fine for Docker Compose with
    # its named volume). Use "s3" for any platform without a persistent/
    # shared disk — works with AWS S3, Cloudflare R2, Supabase Storage, MinIO.
    ATTACHMENT_STORAGE_BACKEND: Literal["local", "s3"] = "local"
    ATTACHMENT_STORAGE_DIR: str = "uploads/attachments"
    ATTACHMENT_MAX_BYTES: int = 10 * 1024 * 1024
    ATTACHMENT_ALLOWED_MIME_TYPES: list[str] | str = [
        "image/gif",
        "image/jpeg",
        "image/png",
        "image/webp",
    ]

    # ── S3-compatible object storage (only used when ATTACHMENT_STORAGE_BACKEND=s3) ──
    S3_BUCKET: str | None = None
    S3_REGION: str = "auto"
    S3_ENDPOINT_URL: str | None = None  # set for R2/MinIO/Supabase; leave unset for AWS S3
    S3_ACCESS_KEY_ID: str | None = None
    S3_SECRET_ACCESS_KEY: str | None = None

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

    @model_validator(mode="after")
    def validate_s3_config(self) -> "Settings":
        if self.ATTACHMENT_STORAGE_BACKEND == "s3" and not (
            self.S3_BUCKET and self.S3_ACCESS_KEY_ID and self.S3_SECRET_ACCESS_KEY
        ):
            raise ValueError(
                "ATTACHMENT_STORAGE_BACKEND=s3 requires S3_BUCKET, S3_ACCESS_KEY_ID, "
                "and S3_SECRET_ACCESS_KEY to be set"
            )
        return self

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
