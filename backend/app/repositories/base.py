# app/repositories/base.py
from __future__ import annotations
from dataclasses import dataclass
from typing import Generic, Iterable, TypeVar

from sqlalchemy.orm import Session
from sqlalchemy import select

T = TypeVar("T")  # SQLAlchemy model type

@dataclass(slots=True)
class Page(Generic[T]):
    items: list[T]
    total: int
    limit: int
    offset: int

class BaseRepository(Generic[T]):
    """Lightweight base for repositories using SQLAlchemy 2.0 style."""
    def __init__(self, db: Session):
        self.db = db

    def page_from_stmt(self, stmt, *, limit: int = 50, offset: int = 0) -> Page[T]:
        total = self.db.execute(
            select(self.model).from_statement(stmt.with_only_columns(self.model.id)).order_by(None)
        ).unique().rowcount  # fallback; for large tables, write a count query
        items = list(self.db.execute(stmt.limit(limit).offset(offset)).scalars().all())
        return Page(items=items, total=total or len(items), limit=limit, offset=offset)

    def add_and_refresh(self, entity: T) -> T:
        self.db.add(entity)
        self.db.flush()
        self.db.refresh(entity)
        return entity
