from fastapi.testclient import TestClient
from app.main import app
import uuid

client = TestClient(app)
def uniq_email(): return f"{uuid.uuid4().hex[:10]}@ex.com"
PWD = "StrongPassw0rd!"

def register(email, pwd=PWD):
    return client.post("/auth/register", json={"email": email, "name": "T", "password": pwd})

def login(email, pwd=PWD):
    return client.post("/auth/login", json={"email": email, "password": pwd})

def test_register_duplicate_email_400():
    e = uniq_email()
    r1 = register(e); assert r1.status_code in (201, 400)
    r2 = register(e); assert r2.status_code == 400

def test_login_unknown_email_401():
    r = login(uniq_email())
    assert r.status_code == 401

def test_login_wrong_password_401():
    e = uniq_email()
    register(e)
    r = login(e, "WrongPass123!")
    assert r.status_code == 401

def test_me_roundtrip_200():
    e = uniq_email()
    register(e)
    tok = login(e).json()["access_token"]
    me = client.get("/auth/me", headers={"Authorization": f"Bearer {tok}"})
    assert me.status_code == 200
    assert me.json()["email"].lower() == e.lower()
