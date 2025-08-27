from fastapi.testclient import TestClient
from app.main import app
from app import main as app_main

client = TestClient(app)

def test_healthz_degraded(monkeypatch):
    # force SessionLocal to throw
    class Boom:
        def __enter__(self): raise RuntimeError("db down")
        def __exit__(self, *a): return False
    monkeypatch.setattr(app_main, "SessionLocal", lambda: Boom())
    r = client.get("/healthz")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "degraded"
    assert "db down" in body["error"]
