"""Key management endpoints."""

import uuid

from fastapi import APIRouter, Depends, Request

from app.core.config import settings
from app.core.dependencies import CurrentUser, DbDep
from app.core.rate_limit import limiter
from app.repositories.key_repository import KeyRepository
from app.repositories.user_repository import UserRepository
from app.schemas.keys import KeyBundleResponse, KeyBundleUpload, KeyStatusResponse, OneTimePrekeyUpload
from app.services.key_service import KeyService

router = APIRouter(prefix="/keys", tags=["keys"])


def _get_key_service(db: DbDep) -> KeyService:
    return KeyService(KeyRepository(db))


@router.post("/upload", status_code=201)
@limiter.limit(settings.RATE_LIMIT_KEYS)
async def upload_key_bundle(
    request: Request,
    bundle: KeyBundleUpload,
    current_user: CurrentUser,
    svc: KeyService = Depends(_get_key_service),
) -> dict:
    await svc.upload_bundle(current_user.id, bundle)
    return {"message": "Key bundle uploaded"}


@router.get("/bundle/{user_id}")
@limiter.limit(settings.RATE_LIMIT_KEYS)
async def get_key_bundle(
    request: Request,
    user_id: uuid.UUID,
    current_user: CurrentUser,
    svc: KeyService = Depends(_get_key_service),
) -> KeyBundleResponse:
    return await svc.get_key_bundle(user_id)


@router.get("/status")
async def key_status(
    current_user: CurrentUser,
    svc: KeyService = Depends(_get_key_service),
) -> KeyStatusResponse:
    return await svc.get_status(current_user.id)


@router.post("/replenish")
@limiter.limit(settings.RATE_LIMIT_KEYS)
async def replenish_prekeys(
    request: Request,
    prekeys: list[OneTimePrekeyUpload],
    current_user: CurrentUser,
    svc: KeyService = Depends(_get_key_service),
) -> dict:
    count = await svc.replenish_prekeys(
        current_user.id,
        [{"key_id": p.key_id, "public_key": p.public_key} for p in prekeys],
    )
    return {"added": count}
