from __future__ import annotations
from typing import Optional
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from app.models import ExerciseSession

class SessionRepository:
    def __init__(self, db: Session):
        self.db = db

    def get(self, session_id: int) -> Optional[ExerciseSession]:
        return self.db.get(ExerciseSession, session_id)

    def list_by_user(self, user_id: int, *, limit: int = 50, offset: int = 0) -> list[ExerciseSession]:
        stmt = select(ExerciseSession).where(ExerciseSession.user_id == user_id)\
                                     .order_by(ExerciseSession.id.desc())\
                                     .limit(limit).offset(offset)
        return self.db.execute(stmt).scalars().all()

    def create(self, user_id: int, *, notes: str | None) -> ExerciseSession:
        sess = ExerciseSession(user_id=user_id, notes=notes)
        self.db.add(sess)
        self.db.commit()
        self.db.refresh(sess)
        return sess
