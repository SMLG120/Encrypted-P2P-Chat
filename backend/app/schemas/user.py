from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class UserPublicProfile(BaseModel):
    id: uuid.UUID
    username: str
    display_name: str
    avatar_url: str | None = None

    model_config = {"from_attributes": True}


class UserSearchResponse(BaseModel):
    users: list[UserPublicProfile]
    total: int
