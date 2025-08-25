from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import Integer, ForeignKey, String, Numeric
from app.db import Base

class ExerciseSet(Base):
    __tablename__ = "exercise_sets"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), index=True)
    exercise: Mapped[str] = mapped_column(String(120), nullable=False)
    target_reps: Mapped[int | None] = mapped_column(Integer, nullable=True)
    weight: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)

    session = relationship("ExerciseSession", back_populates="sets")
    reps = relationship("RepEvent", back_populates="set", cascade="all, delete-orphan")
