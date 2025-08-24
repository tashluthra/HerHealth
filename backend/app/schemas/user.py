from __future__ import annotations
from pydantic import BaseModel, EmailStr
from datetime import datetime

class UserBase(BaseModel):
    email: EmailStr
    name: str

class UserCreate(UserBase):
    """Payload used when creating a user."""
    pass

class UserRead(UserBase):
    """What the API returns back to clients."""
    id: int
    created_at: datetime | None = None

    model_config = {"from_attributes": True}  # allow ORM objects -> schema

