from typing import Annotated
from pydantic import BaseModel, Field, field_validator

# Keep max length via Field
ExerciseStr = Annotated[str, Field(max_length=120)]
PosInt = Annotated[int, Field(ge=1)]
NonNegFloat = Annotated[float, Field(ge=0, le=1000)]

class SetCreate(BaseModel):
    exercise: ExerciseStr
    target_reps: PosInt | None = None
    weight: NonNegFloat | None = None

    @field_validator("exercise")
    @classmethod
    def exercise_non_blank(cls, v: str) -> str:
        v2 = v.strip()
        if not v2:
            raise ValueError("exercise cannot be blank")
        return v2  # return the trimmed value so your DB gets clean text

class SetRead(BaseModel):
    id: int
    session_id: int
    exercise: str
    target_reps: int | None = None
    weight: float | None = None

    model_config = {"from_attributes": True}

