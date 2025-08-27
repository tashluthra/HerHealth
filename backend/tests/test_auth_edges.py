from fastapi.testclient import TestClient
from app.main import app
from app.security import create_access_token
import uuid

client = TestClient(app)
def unique(): return f"{uuid.uuid4().hex[:10]}@ex.com"

def test_token_expired():
    # create a user (so the user id exists)
    email = unique(); pw = "StrongPassw0rd!"
    client.post("/auth/register", json={"email": email, "name": "Y", "password": pw})
    # login to get user id via /auth/me
    tok = client.post("/auth/login", json={"email": email, "password": pw}).json()["access_token"]
    me = client.get("/auth/me", headers={"Authorization": f"Bearer {tok}"}).json()
    user_id = me["id"]

    # craft an already-expired token for the same user id
    expired = create_access_token(str(user_id), expires_minutes=-1)

    r = client.get("/auth/me", headers={"Authorization": f"Bearer {expired}"})
    assert r.status_code == 401
