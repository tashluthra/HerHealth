from typing import Annotated
from enum import Enum
from datetime import datetime
from pydantic import BaseModel, EmailStr, Field, field_validator

class UserRole(str, Enum):
    user = "user"
    clinician = "clinician"
    admin = "admin"

# Reusable constrained strings
NameStr = Annotated[str, Field(strip_whitespace=True, min_length=1, max_length=120)]

class UserBase(BaseModel):
    email: EmailStr = Field(max_length=255)
    name: NameStr

# Legacy create for /users (no password)
class UserCreate(UserBase):
    pass

class UserRegister(UserBase):
    # No regex: use validator below
    password: Annotated[str, Field(min_length=12, max_length=128)]

    @field_validator("password")
    @classmethod
    def password_policy(cls, v: str) -> str:
        # Require lower, upper, digit, special
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
