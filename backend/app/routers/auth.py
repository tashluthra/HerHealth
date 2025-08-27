from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.db import get_db
from app.models import User
from app.schemas.user import UserRegister, UserLogin, UserRead
from app.security import hash_password, verify_password, create_access_token
from app.deps.auth import get_current_user
from app.repositories.user_repo import UserRepository

router = APIRouter(prefix="/auth", tags=["auth"])

@router.post("/register", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def register(payload: UserRegister, db: Session = Depends(get_db)):
    repo = UserRepository(db)
    if repo.get_by_email(payload.email):
        raise HTTPException(status_code=400, detail="email already registered")
    try:
        user = repo.create(
            email=payload.email,
            name=payload.name,
            password_hash=hash_password(payload.password),
            role="user",
        )
    except ValueError as e:
        if str(e) == "email_already_exists":
            raise HTTPException(status_code=400, detail="email already registered")
        raise
    return user

@router.post("/login")
def login(payload: UserLogin, db: Session = Depends(get_db)):
    repo = UserRepository(db)
    user = repo.get_by_email(payload.email)
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="invalid credentials")
    token = create_access_token(sub=str(user.id))
    return {"access_token": token, "token_type": "bearer"}

@router.get("/me", response_model=UserRead)
def me(current_user: User = Depends(get_current_user)):
    return current_user