from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .settings import get_settings

app = FastAPI(title="HerHealth API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/ping")
def ping():
    s = get_settings()
    return {"status": "ok", "env": s.ENV}
