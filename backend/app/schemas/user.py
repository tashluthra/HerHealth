from typing import Annotated
from pydantic import BaseModel, EmailStr, Field, field_validator
from enum import Enum
from datetime import datetime

class UserRole(str, Enum):
    user = "user"
    clinician = "clinician"
    admin = "admin"

NameStr = Annotated[str, Field(strip_whitespace=True, min_length=1, max_length=120)]

class UserBase(BaseModel):
    email: EmailStr = Field(max_length=255)
    name: NameStr

class UserCreate(UserBase):
    pass  # legacy endpoint if you still have /users

class UserRegister(UserBase):
    # no regex here—Pydantic v2 core regex doesn't support look-arounds
    password: Annotated[str, Field(min_length=12, max_length=128)]

    @field_validator("password")
    @classmethod
    def password_policy(cls, v: str) -> str:
        # OWASP-ish: require lower, upper, digit, special
        if not any(c.islower() for c in v):
            raise ValueError("password must include a lowercase letter")
        if not any(c.isupper() for c in v):
            raise ValueError("password must include an uppercase letter")
        if not any(c.isdigit() for c in v):
            raise ValueError("password must include a digit")
        if not any(not c.isalnum() for c in v):
            raise ValueError("password must include a special character")
        return v

class UserLogin(BaseModel):
    email: EmailStr
    password: Annotated[str, Field(min_length=1, max_length=256)]

class UserRead(UserBase):
    id: int
    role: UserRole
    created_at: datetime
    model_config = {"from_attributes": True}
