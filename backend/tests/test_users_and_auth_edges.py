# tests/test_users_and_auth_edges.py
import uuid
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def uniq_email(prefix="u"):
    return f"{prefix}-{uuid.uuid4().hex[:8]}@ex.com"

def make_user(email=None, password="StrongPassw0rd!"):
    email = email or uniq_email("usr")
    r = client.post("/auth/register", json={"email": email, "name": "Test", "password": password})
    # allow re-runs (201 first time, 400 if already exists)
    assert r.status_code in (201, 400), r.text
    return email, password

def login(email, password):
    # IMPORTANT: your /auth/login expects JSON, not form
    r = client.post("/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]

def test_list_users_forbidden_for_non_admin():
    e, pw = make_user(uniq_email("forbidden"))
    token = login(e, pw)
    r = client.get("/users", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403, r.text
    assert r.json()["detail"] == "Insufficient role"

def test_duplicate_email_create_rejected():
    # target email we will attempt to create twice
    dup_email = uniq_email("dupe")
    _ = make_user(dup_email)

    # create an admin
    admin_email, admin_pw = make_user(uniq_email("admin"))

    # promote to admin via repo (no docker shell)
    from app.db import SessionLocal
    from app.repositories.user_repo import UserRepository
    db = SessionLocal()
    repo = UserRepository(db)
    admin = repo.get_by_email(admin_email)
    admin.role = "admin"
    db.commit()
    db.close()

    admin_token = login(admin_email, admin_pw)

    # attempt to create the SAME email again via the admin-only POST /users
    r = client.post(
        "/users",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"email": dup_email, "name": "Another"},
    )
    assert r.status_code == 400, r.text
    assert "already" in r.json()["detail"].lower()

def test_expired_token_rejected(monkeypatch):
    e, pw = make_user(uniq_email("expire"))
    token = login(e, pw)

    # Patch the exact symbol used in the guard
    from jose.exceptions import ExpiredSignatureError
    def fake_decode(_): raise ExpiredSignatureError()

    # IMPORTANT: deps.auth imports decode_token at import-time
    import app.deps.auth as deps_auth
    monkeypatch.setattr(deps_auth, "decode_token", fake_decode)

    # Hit an auth-only endpoint (no admin role required)
    r = client.post("/sessions",
                    headers={"Authorization": f"Bearer {token}"},
                    json={"notes": "should not matter"})
    assert r.status_code == 401, r.text
    assert r.json()["detail"] == "Token expired"
