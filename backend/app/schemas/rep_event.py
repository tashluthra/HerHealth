from typing import Annotated
from datetime import datetime
from pydantic import BaseModel, Field

RepIndex = Annotated[int, Field(ge=1)]

class RepCreate(BaseModel):
    # Optional: if omitted, the server can auto-increment based on the last rep in the set
    rep_index: RepIndex | None = None

class RepRead(BaseModel):
    id: int
    set_id: int
    timestamp: datetime
    rep_index: int

    model_config = {"from_attributes": True}
