"""
Auth endpoints — WebAuthn passkey registration and login.

Flow:
  Registration:
    POST /auth/register/options  → returns challenge + options
    POST /auth/register/verify   → verifies credential, creates user, sets cookie

  Login:
    POST /auth/login/options     → returns challenge + allow-list
    POST /auth/login/verify      → verifies assertion, sets cookie
"""

from fastapi import APIRouter, Depends, Request, Response

from app.core.config import settings
from app.core.dependencies import CurrentUser, DbDep, RedisDep, create_session_cookie
from app.core.exceptions import AppError
from app.core.logging import audit_log
from app.core.rate_limit import limiter
from app.repositories.user_repository import UserRepository
from app.schemas.auth import (
    AuthResponse,
    LoginOptionsRequest,
    LoginVerifyRequest,
    RegistrationOptionsRequest,
    RegistrationVerifyRequest,
    UserResponse,
)
from app.services.auth_service import AuthService

router = APIRouter(prefix="/auth", tags=["auth"])


def _get_auth_service(db: DbDep, redis: RedisDep) -> AuthService:
    return AuthService(UserRepository(db), redis)


@router.post("/register/options")
@limiter.limit(settings.RATE_LIMIT_AUTH)
async def registration_options(
    request: Request,
    body: RegistrationOptionsRequest,
    auth_svc: AuthService = Depends(_get_auth_service),
) -> dict:
    return await auth_svc.begin_registration(body.username, body.display_name)


@router.post("/register/verify")
@limiter.limit(settings.RATE_LIMIT_AUTH)
async def registration_verify(
    request: Request,
    body: RegistrationVerifyRequest,
    response: Response,
    auth_svc: AuthService = Depends(_get_auth_service),
) -> AuthResponse:
    user = await auth_svc.complete_registration(
        username=body.username,
        display_name=body.display_name,
        credential_raw=body.credential,
    )

    session_value = create_session_cookie(user.id)
    response.set_cookie(
        key=settings.SESSION_COOKIE_NAME,
        value=session_value,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
        max_age=settings.SESSION_MAX_AGE,
    )

    return AuthResponse(user=UserResponse.model_validate(user))


@router.post("/login/options")
@limiter.limit(settings.RATE_LIMIT_AUTH)
async def login_options(
    request: Request,
    body: LoginOptionsRequest,
    auth_svc: AuthService = Depends(_get_auth_service),
) -> dict:
    return await auth_svc.begin_login(body.username)


@router.post("/login/verify")
@limiter.limit(settings.RATE_LIMIT_AUTH)
async def login_verify(
    request: Request,
    body: LoginVerifyRequest,
    response: Response,
    auth_svc: AuthService = Depends(_get_auth_service),
) -> AuthResponse:
    user = await auth_svc.complete_login(
        username=body.username,
        credential_raw=body.credential,
    )

    session_value = create_session_cookie(user.id)
    response.set_cookie(
        key=settings.SESSION_COOKIE_NAME,
        value=session_value,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
        max_age=settings.SESSION_MAX_AGE,
    )

    return AuthResponse(user=UserResponse.model_validate(user))


@router.post("/logout")
async def logout(response: Response, current_user: CurrentUser) -> dict:
    response.delete_cookie(settings.SESSION_COOKIE_NAME)
    audit_log("user_logged_out", user_id=current_user.id)
    return {"message": "Logged out"}


@router.get("/me")
async def me(current_user: CurrentUser) -> UserResponse:
    return UserResponse.model_validate(current_user)
