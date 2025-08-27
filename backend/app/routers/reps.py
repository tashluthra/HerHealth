from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.db import get_db
from app.schemas.rep_event import RepCreate, RepRead
from app.repositories.set_repo import SetRepository
from app.repositories.session_repo import SessionRepository
from app.repositories.rep_repo import RepRepository
from app.deps.auth import get_current_user
from app.models import User

router = APIRouter(prefix="/sets", tags=["reps"])

@router.post("/{set_id}/rep", response_model=RepRead, status_code=status.HTTP_201_CREATED)
def log_rep(
    set_id: int,
    payload: RepCreate,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    set_repo = SetRepository(db)
    s = set_repo.get(set_id)
    if not s:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Set not found")

    # Ownership check via set -> session -> user
    sess = SessionRepository(db).get(s.session_id)
    if not sess:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Parent session not found")

    if sess.user_id != current.id and current.role not in ("clinician", "admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed for this set")

    ev = RepRepository(db).create(set_id=set_id, rep_index=payload.rep_index)
    return ev
