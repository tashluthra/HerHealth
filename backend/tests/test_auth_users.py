from fastapi.testclient import TestClient
from app.main import app
import uuid

client = TestClient(app)

def unique_email():
    return f"u_{uuid.uuid4().hex[:10]}@example.com"

def test_register_weak_password_rejected():
    r = client.post("/auth/register", json={"email": unique_email(), "name": "Weak", "password": "short"})
    assert r.status_code == 422

def test_register_login_and_me():
    email = unique_email()
    pwd = "StrongPassw0rd!"
    # register
    r = client.post("/auth/register", json={"email": email, "name": "Ok", "password": pwd})
    assert r.status_code in (201, 400)  # 400 if re-run
    # login
    r = client.post("/auth/login", json={"email": email, "password": pwd})
    assert r.status_code == 200
    token = r.json()["access_token"]
    # me
    r = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    body = r.json()
    assert body["email"] == email
    assert "password_hash" not in body
