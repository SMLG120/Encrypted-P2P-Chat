"""Room (conversation) endpoints."""

import uuid

from fastapi import APIRouter, Depends

from app.core.dependencies import CurrentUser, DbDep
from app.core.exceptions import ForbiddenError
from app.repositories.room_repository import RoomRepository
from app.repositories.user_repository import UserRepository
from app.schemas.room import AddMemberRequest, RoomCreate, RoomResponse
from app.services.room_service import RoomService

router = APIRouter(prefix="/rooms", tags=["rooms"])


def _get_room_service(db: DbDep) -> RoomService:
    return RoomService(RoomRepository(db), UserRepository(db))


@router.post("", status_code=201)
async def create_room(
    body: RoomCreate,
    current_user: CurrentUser,
    svc: RoomService = Depends(_get_room_service),
) -> RoomResponse:
    if body.type == "direct":
        if len(body.member_ids) != 1:
            raise ForbiddenError("Direct rooms require exactly one other member")
        room = await svc.create_or_get_direct_room(current_user.id, body.member_ids[0])
    else:
        room = await svc.create_group_room(current_user.id, body.member_ids)
    return RoomResponse.model_validate(room)


@router.get("")
async def list_rooms(
    current_user: CurrentUser,
    svc: RoomService = Depends(_get_room_service),
) -> list[RoomResponse]:
    rooms = await svc.list_rooms(current_user.id)
    return [RoomResponse.model_validate(r) for r in rooms]


@router.get("/{room_id}")
async def get_room(
    room_id: uuid.UUID,
    current_user: CurrentUser,
    svc: RoomService = Depends(_get_room_service),
) -> RoomResponse:
    room = await svc.get_room_for_user(room_id, current_user.id)
    return RoomResponse.model_validate(room)


@router.post("/{room_id}/members", status_code=201)
async def add_member(
    room_id: uuid.UUID,
    body: AddMemberRequest,
    current_user: CurrentUser,
    svc: RoomService = Depends(_get_room_service),
) -> dict:
    await svc.add_member(room_id, current_user.id, body.user_id)
    return {"message": "Member added"}


@router.delete("/{room_id}/members/{user_id}")
async def remove_member(
    room_id: uuid.UUID,
    user_id: uuid.UUID,
    current_user: CurrentUser,
    svc: RoomService = Depends(_get_room_service),
) -> dict:
    await svc.remove_member(room_id, current_user.id, user_id)
    return {"message": "Member removed"}
