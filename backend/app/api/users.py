"""User search and profile endpoints."""

import uuid

from fastapi import APIRouter, Query, Request

from app.core.config import settings
from app.core.dependencies import CurrentUser, DbDep
from app.core.rate_limit import limiter
from app.repositories.user_repository import UserRepository
from app.schemas.auth import UserResponse
from app.schemas.user import UserPublicProfile, UserSearchResponse

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/search")
@limiter.limit(settings.RATE_LIMIT_SEARCH)
async def search_users(
    request: Request,
    q: str = Query(..., min_length=2, max_length=64),
    limit: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0),
    current_user: CurrentUser = None,
    db: DbDep = None,
) -> UserSearchResponse:
    repo = UserRepository(db)
    users, total = await repo.search(q, limit=limit, offset=offset)
    return UserSearchResponse(
        users=[UserPublicProfile.model_validate(u) for u in users],
        total=total,
    )


@router.get("/{user_id}")
async def get_user(
    user_id: uuid.UUID,
    current_user: CurrentUser,
    db: DbDep,
) -> UserPublicProfile:
    from app.core.exceptions import UserNotFoundError

    repo = UserRepository(db)
    user = await repo.get_by_id(user_id)
    if not user:
        raise UserNotFoundError()
    return UserPublicProfile.model_validate(user)
