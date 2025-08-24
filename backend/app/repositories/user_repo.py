from __future__ import annotations
from sqlalchemy.orm import Session
from sqlalchemy import select
from app.models.user import User
from app.schemas.user import UserCreate

class UserRepository:
    """Keeps DB logic out of the routes. Easier to test."""

    def __init__(self, db: Session):
        self.db = db

    def create(self, data: UserCreate) -> User:
        user = User(email=str(data.email), name=data.name)
        self.db.add(user)
        self.db.commit()
        self.db.refresh(user)
        return user

    def get(self, user_id: int) -> User | None:
        return self.db.get(User, user_id)

    def get_by_email(self, email: str) -> User | None:
        return self.db.scalar(select(User).where(User.email == email))

    def list(self, limit: int = 50, offset: int = 0) -> list[User]:
        return list(self.db.scalars(select(User).limit(limit).offset(offset)))
