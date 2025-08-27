# app/deps/auth.py
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from jose.exceptions import ExpiredSignatureError, JWTError

from app.db import get_db
from app.models import User
from app.security import decode_token

# Exposes Bearer auth in Swagger; login endpoint issues the token
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")

def get_current_user(
    db: Session = Depends(get_db),
    token: str = Depends(oauth2_scheme),
) -> User:
    unauth = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_token(token)
        sub = payload.get("sub")
        if sub is None:
            raise unauth
        user = db.get(User, int(sub))
    except ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except JWTError:
        raise unauth

    if not user:
        raise unauth
    return user

def require_role(*allowed_roles: str):
    """
    Usage: dependencies=[Depends(require_role("clinician","admin"))]
    """
    def dependency(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient role",
            )
        return current_user
    return dependency

def require_user_or_role(user_id_param: str, *allowed_roles: str):
    """
    Owner-or-admin style guard.

    Usage:
      @router.get("/users/{user_id}")
      def get_user(user_id: int, current=Depends(require_user_or_role("user_id","admin"))):
          ...

    Allows if:
      - current_user.id == path param {user_id}
      - OR current_user.role in allowed_roles
    """
    def dependency(
        current_user: User = Depends(get_current_user),
        # FastAPI injects path/query params that match by name
        **params,
    ) -> User:
        # Extract param (must exist in path or query)
        if user_id_param not in params:
            raise HTTPException(status_code=500, detail=f"Missing parameter '{user_id_param}'")
        target_user_id = int(params[user_id_param])

        if current_user.id == target_user_id:
            return current_user
        if current_user.role in allowed_roles:
            return current_user

        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed")
    return dependency
