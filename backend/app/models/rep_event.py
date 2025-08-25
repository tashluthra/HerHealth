from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import Integer, ForeignKey, DateTime, func
from app.db import Base

class RepEvent(Base):
    __tablename__ = "rep_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    set_id: Mapped[int] = mapped_column(ForeignKey("exercise_sets.id", ondelete="CASCADE"), index=True)
    timestamp: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    rep_index: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    set = relationship("ExerciseSet", back_populates="reps")
