from fastapi.testclient import TestClient
from app.main import app
from app.db import SessionLocal
from app.repositories.session_repo import SessionRepository
from app.repositories.set_repo import SetRepository
from app.repositories.rep_repo import RepRepository
import uuid

client = TestClient(app)
PWD = "StrongPassw0rd!"
def uniq_email(): return f"{uuid.uuid4().hex[:10]}@ex.com"

def mk_user_and_token():
    e = uniq_email()
    r = client.post("/auth/register", json={"email": e, "name": "S", "password": PWD})
    assert r.status_code in (201, 400)
    t = client.post("/auth/login", json={"email": e, "password": PWD}).json()["access_token"]
    return e, t
