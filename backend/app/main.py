"""
FastAPI application factory.

Design choices:
- Factory function (create_app) enables testing with different configs.
- All routers registered with /api/v1 prefix.
- Global exception handlers translate AppError → HTTP.
- SlowAPI rate limiter attached as middleware.
- Security headers set on every response via middleware.
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from redis.exceptions import RedisError
from sqlalchemy.exc import SQLAlchemyError
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.api import auth, health, keys, messages, rooms, users, websocket
from app.core.config import settings
from app.core.exceptions import AppError
from app.core.logging import configure_logging, get_logger
from app.core.rate_limit import limiter

log = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging()
    log.info(
        "app_startup",
        name=settings.APP_NAME,
        version=settings.APP_VERSION,
        environment=settings.ENVIRONMENT,
    )
    yield
    log.info("app_shutdown")


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.APP_NAME,
        version=settings.APP_VERSION,
        docs_url="/api/docs" if not settings.is_production else None,
        redoc_url="/api/redoc" if not settings.is_production else None,
        lifespan=lifespan,
    )

    # ── Rate limiting ──────────────────────────────────────────────────────
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    app.add_middleware(SlowAPIMiddleware)

    # ── CORS ───────────────────────────────────────────────────────────────
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "Accept"],
    )

    # ── Security headers middleware ────────────────────────────────────────
    @app.middleware("http")
    async def add_security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        if settings.is_production:
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response

    # ── Global exception handler ───────────────────────────────────────────
    @app.exception_handler(AppError)
    async def app_error_handler(request: Request, exc: AppError):
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.detail},
        )

    @app.exception_handler(SQLAlchemyError)
    async def sqlalchemy_error_handler(request: Request, exc: SQLAlchemyError):
        log.error(
            "database_unavailable",
            path=request.url.path,
            error_type=exc.__class__.__name__,
        )
        return JSONResponse(
            status_code=503,
            content={"detail": "Database unavailable. Please try again shortly."},
        )

    @app.exception_handler(RedisError)
    async def redis_error_handler(request: Request, exc: RedisError):
        log.error(
            "redis_unavailable",
            path=request.url.path,
            error_type=exc.__class__.__name__,
        )
        return JSONResponse(
            status_code=503,
            content={"detail": "Session store unavailable. Please try again shortly."},
        )

    # ── Routers ────────────────────────────────────────────────────────────
    prefix = "/api/v1"
    app.include_router(health.router)
    app.include_router(auth.router, prefix=prefix)
    app.include_router(users.router, prefix=prefix)
    app.include_router(keys.router, prefix=prefix)
    app.include_router(rooms.router, prefix=prefix)
    app.include_router(messages.router, prefix=prefix)
    app.include_router(websocket.router)

    return app


app = create_app()
