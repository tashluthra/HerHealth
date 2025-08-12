from fastapi import FastAPI
from .settings import get_settings

app = FastAPI(title="HerHealth API")

@app.get("/ping")
def ping():
    s = get_settings()
    return {"status": "ok", "env": s.ENV}
