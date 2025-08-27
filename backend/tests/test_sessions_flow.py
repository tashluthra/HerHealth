from fastapi.testclient import TestClient
from app.main import app
import uuid

client = TestClient(app)

def unique_email():
    return f"u_{uuid.uuid4().hex[:10]}@example.com"

def login_token():
    email = unique_email()
    pwd = "StrongPassw0rd!"
    client.post("/auth/register", json={"email": email, "name": "Ok", "password": pwd})
    r = client.post("/auth/login", json={"email": email, "password": pwd})
    assert r.status_code == 200
    return r.json()["access_token"]

def test_create_session_add_set_and_log_rep():
    token = login_token()
    H = {"Authorization": f"Bearer {token}"}

    # create session
    r = client.post("/sessions", headers=H, json={"notes": "morning workout"})
    assert r.status_code == 201
    session_id = r.json()["id"]

    # add set
    r = client.post(f"/sessions/{session_id}/sets", headers=H,
                    json={"exercise": "Squat", "target_reps": 5, "weight": 60})
    assert r.status_code == 201
    set_id = r.json()["id"]

    # log rep (auto = 1)
    r = client.post(f"/sets/{set_id}/rep", headers=H, json={})
    assert r.status_code == 201
    assert r.json()["rep_index"] == 1

def test_requires_auth():
    # no token -> 401s
    assert client.get("/sessions").status_code in (401, 403)
    assert client.post("/sessions", json={"notes": "x"}).status_code in (401, 403)
