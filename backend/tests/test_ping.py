from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_ping():
    r = client.get("/ping")
    assert r.status_code == 200
    assert r.json() == {"pong": True}

def test_healthz():
    r = client.get("/healthz")
    assert r.status_code == 200
    assert r.json()["status"] in {"ok", "degraded"}

def test_version():
    r = client.get("/version")
    assert r.status_code == 200
    assert "version" in r.json()
