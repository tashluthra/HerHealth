from fastapi.testclient import TestClient
from app.main import app
import uuid

client = TestClient(app)
def email(): return f"{uuid.uuid4().hex[:10]}@ex.com"
PWD = "StrongPassw0rd!"

def token(e=None):
    e = e or email()
    client.post("/auth/register", json={"email": e, "name": "U", "password": PWD})
    return client.post("/auth/login", json={"email": e, "password": PWD}).json()["access_token"]

def test_add_set_404_for_missing_session():
    t = token()
    h = {"Authorization": f"Bearer {t}"}
    r = client.post("/sessions/999999/sets", headers=h, json={"exercise":"X","target_reps":5,"weight":10})
    assert r.status_code == 404

def test_log_rep_404_for_missing_set():
    t = token()
    h = {"Authorization": f"Bearer {t}"}
    r = client.post("/sets/999999/rep", headers=h, json={})
    assert r.status_code == 404
