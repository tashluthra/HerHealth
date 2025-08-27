from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from app.db import get_db
from app.schemas.session import SessionCreate, SessionRead
from app.schemas.exercise_set import SetRead  # for optional expansion later
from app.models import ExerciseSession
from app.repositories.session_repo import SessionRepository
from app.deps.auth import get_current_user
from app.models import User  # type only

router = APIRouter(prefix="/sessions", tags=["sessions"])

@router.post("", response_model=SessionRead, status_code=status.HTTP_201_CREATED)
def create_session(payload: SessionCreate, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    sess = SessionRepository(db).create(user_id=current.id, notes=payload.notes)
    return sess

@router.get("", response_model=list[SessionRead])
def list_my_sessions(
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    sessions = SessionRepository(db).list_by_user(current.id, limit=limit, offset=offset)
    return sessions
