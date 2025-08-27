from __future__ import annotations
from typing import Optional
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from app.models import RepEvent

class RepRepository:
    def __init__(self, db: Session):
        self.db = db

    def create(self, set_id: int, *, rep_index: Optional[int]) -> RepEvent:
        if rep_index is None:
            # Auto-increment based on current max for this set
            max_idx = self.db.execute(
                select(func.max(RepEvent.rep_index)).where(RepEvent.set_id == set_id)
            ).scalar_one()
            rep_index = (max_idx or 0) + 1

        ev = RepEvent(set_id=set_id, rep_index=rep_index)
        self.db.add(ev)
        self.db.commit()
        self.db.refresh(ev)
        return ev
