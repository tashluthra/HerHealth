from fastapi.testclient import TestClient
from app.main import app
from app.db import SessionLocal
from app.repositories.user_repo import UserRepository
import uuid

client = TestClient(app)
PWD = "StrongPassw0rd!"
def uniq(): return f"{uuid.uuid4().hex[:8]}@ex.com"

def make_user(email):
    client.post("/auth/register", json={"email": email, "name": "U", "password": PWD})
    tok = client.post("/auth/login", json={"email": email, "password": PWD}).json()["access_token"]
    return tok

def test_owner_or_admin_access():
    # Owner
    owner_email = uniq()
    owner_token = make_user(owner_email)

    # Admin
    admin_email = uniq()
    make_user(admin_email)

    # Promote to admin via repo (pure Python)
    db = SessionLocal()
    repo = UserRepository(db)
    admin = repo.get_by_email(admin_email)
    repo.set_role(admin.id, role="admin")   # <-- fixed

    db.close()

    # Re-login to get a fresh token (role embedded/checked on access)
    admin_token = client.post("/auth/login", json={"email": admin_email, "password": PWD}).json()["access_token"]

    # Owner creates a session
    s = client.post("/sessions", headers={"Authorization": f"Bearer {owner_token}"}, json={"notes": "mine"}).json()
    sid = s["id"]

    # Admin can add a set to owner's session (owner-or-admin guard)
    r = client.post(
        f"/sessions/{sid}/sets",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"exercise": "X", "target_reps": 1, "weight": 1},
    )
    assert r.status_code == 201
