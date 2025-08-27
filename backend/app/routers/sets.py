from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.db import get_db
from app.schemas.exercise_set import SetCreate, SetRead
from app.repositories.session_repo import SessionRepository
from app.repositories.set_repo import SetRepository
from app.deps.auth import get_current_user
from app.models import User

router = APIRouter(prefix="/sessions", tags=["sets"])

@router.post("/{session_id}/sets", response_model=SetRead, status_code=status.HTTP_201_CREATED)
def add_set(
    session_id: int,
    payload: SetCreate,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    srepo = SessionRepository(db)
    sess = srepo.get(session_id)
    if not sess:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    # Owner or privileged role
    if sess.user_id != current.id and current.role not in ("clinician", "admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed for this session")

    new_set = SetRepository(db).create(
        session_id=session_id,
        exercise=payload.exercise,
        target_reps=payload.target_reps,
        weight=payload.weight,
    )
    return new_set
