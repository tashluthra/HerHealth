from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from app.db import get_db
from app.repositories.user_repo import UserRepository
from app.schemas.user import UserCreate, UserRead
from app.deps.auth import require_role, require_user_or_role

router = APIRouter(prefix="/users", tags=["users"])

@router.get("", response_model=list[UserRead], dependencies=[Depends(require_role("admin"))])
def list_users(
    db: Session = Depends(get_db),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    page = UserRepository(db).list(limit=limit, offset=offset)
    # If you want to expose total/limit/offset, wrap in an object schema instead
    return page.items

@router.get("/{user_id}", response_model=UserRead)
def get_user(
    user_id: int,
    db: Session = Depends(get_db),
    _auth=Depends(require_user_or_role("user_id", "admin")),  # owner or admin
):
    user = UserRepository(db).get(user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user

# Optional admin-only create (register is preferred for normal signups)
@router.post("", response_model=UserRead, status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(require_role("admin"))])
def create_user(payload: UserCreate, db: Session = Depends(get_db)):
    repo = UserRepository(db)
    if repo.get_by_email(payload.email):
        raise HTTPException(status_code=400, detail="email already registered")
    try:
        user = repo.create(email=payload.email, name=payload.name, password_hash="", role="user")
    except ValueError as e:
        if str(e) == "email_already_exists":
            raise HTTPException(status_code=400, detail="email already registered")
        raise
    return user
