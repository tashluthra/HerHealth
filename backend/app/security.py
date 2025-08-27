from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional
from passlib.context import CryptContext
from jose import jwt
from jose.exceptions import ExpiredSignatureError, JWTError
from passlib.context import CryptContext
from app.settings import get_settings

pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")

def hash_password(p: str) -> str:
    return pwd_ctx.hash(p)

def verify_password(plain: str, hashed: str) -> bool:
    return pwd_ctx.verify(plain, hashed)

def create_access_token(
    sub: str,
    *,
    expires_minutes: Optional[int] = None,
    extra: Optional[Dict[str, Any]] = None,
) -> str:
    s = get_settings()
    now = datetime.now(timezone.utc)
    exp = now + timedelta(minutes=expires_minutes or s.ACCESS_TOKEN_EXPIRE_MINUTES)
    payload: Dict[str, Any] = {
        "sub": sub,
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, s.SECRET_KEY, algorithm=s.ALGORITHM)

def decode_token(token: str) -> Dict[str, Any]:
    s = get_settings()
    return jwt.decode(token, s.SECRET_KEY, algorithms=[s.ALGORITHM])