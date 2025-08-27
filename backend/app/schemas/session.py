from typing import Annotated
from datetime import datetime
from pydantic import BaseModel, Field

# Notes: trimmed, up to 500 chars
NotesStr = Annotated[str, Field(strip_whitespace=True, max_length=500)]

class SessionCreate(BaseModel):
    notes: NotesStr | None = None

class SessionRead(BaseModel):
    id: int
    user_id: int
    started_at: datetime
    ended_at: datetime | None = None
    notes: str | None = None

    model_config = {"from_attributes": True}
