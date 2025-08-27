# app/repositories/user_repo.py
from __future__ import annotations
from typing import Iterable, Optional

from sqlalchemy import select, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import User
from app.repositories.base import BaseRepository, Page

class UserRepository(BaseRepository[User]):
    model = User

    # READS
    def get(self, user_id: int) -> Optional[User]:
        return self.db.get(User, user_id)

    def get_by_email(self, email: str) -> Optional[User]:
        stmt = select(User).where(func.lower(User.email) == email.lower())
        return self.db.execute(stmt).scalar_one_or_none()

    def list(self, *, limit: int = 50, offset: int = 0) -> Page[User]:
        stmt = select(User).order_by(User.id.asc())
        # Simple and fast: do one query for items and one for count
        items = self.db.execute(stmt.limit(limit).offset(offset)).scalars().all()
        total = self.db.execute(select(func.count()).select_from(User)).scalar_one()
        return Page(items=list(items), total=total, limit=limit, offset=offset)

    # WRITES
    def create(self, *, email: str, name: str, password_hash: str, role: str = "user") -> User:
        user = User(email=email, name=name, password_hash=password_hash, role=role)
        try:
            self.db.add(user)
            self.db.commit()
            self.db.refresh(user)
            return user
        except IntegrityError:
            self.db.rollback()
            # Re-raise a clean marker your router can map to 400
            raise ValueError("email_already_exists")

    def update_name(self, user_id: int, *, name: str) -> Optional[User]:
        user = self.get(user_id)
        if not user:
            return None
        user.name = name
        self.db.commit()
        self.db.refresh(user)
        return user

    def set_role(self, user_id: int, *, role: str) -> Optional[User]:
        """Use from an admin-only route; DB enum validates role values."""
        user = self.get(user_id)
        if not user:
            return None
        user.role = role
        self.db.commit()
        self.db.refresh(user)
        return user
