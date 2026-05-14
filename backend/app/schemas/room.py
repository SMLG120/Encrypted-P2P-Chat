"""Room schemas."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.auth import UserResponse


class RoomCreate(BaseModel):
    type: Literal["direct", "group"] = "direct"
    member_ids: list[uuid.UUID] = Field(..., min_length=1, max_length=50)


class MembershipResponse(BaseModel):
    user_id: uuid.UUID
    role: str
    joined_at: datetime
    user: UserResponse | None = None

    model_config = {"from_attributes": True}


class RoomResponse(BaseModel):
    id: uuid.UUID
    type: str
    created_by: uuid.UUID | None
    created_at: datetime
    members: list[MembershipResponse] = Field(
        default_factory=list,
        validation_alias="memberships",
    )

    model_config = {"from_attributes": True}


class AddMemberRequest(BaseModel):
    user_id: uuid.UUID
