from __future__ import annotations
from typing import Optional
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.models import ExerciseSet

class SetRepository:
    def __init__(self, db: Session):
        self.db = db

    def get(self, set_id: int) -> Optional[ExerciseSet]:
        return self.db.get(ExerciseSet, set_id)

    def list_by_session(self, session_id: int) -> list[ExerciseSet]:
        stmt = select(ExerciseSet).where(ExerciseSet.session_id == session_id).order_by(ExerciseSet.id.asc())
        return self.db.execute(stmt).scalars().all()

    def create(self, session_id: int, *, exercise: str, target_reps: int | None, weight: float | None) -> ExerciseSet:
        s = ExerciseSet(session_id=session_id, exercise=exercise, target_reps=target_reps, weight=weight)
        self.db.add(s)
        self.db.commit()
        self.db.refresh(s)
        return s
