from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional
from passlib.context import CryptContext
from jose import jwt
from jose.exceptions import ExpiredSignatureError, JWTError
from app.settings import get_settings

settings = get_settings()
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
    """
    Verify signature and expiration. Raise if token is expired/invalid.
    """
    s = get_settings()
    payload = jwt.decode(
        token,
        s.SECRET_KEY,
        algorithms=[s.ALGORITHM],
        options={
            "verify_signature": True,
            "verify_exp": True,   # ensure `exp` is checked
        },
        # leeway=5,  # optional: allow small clock skew (seconds)
    )
    # If you want to hard-require the claim to exist explicitly:
    if "exp" not in payload:
        raise JWTError("Missing exp")
    return payload
