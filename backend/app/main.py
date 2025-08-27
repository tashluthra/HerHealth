# app/main.py
import os
import time
import logging
import uuid
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.routers.auth import router as auth_router
from app.routers.users import router as users_router
from app.routers.sessions import router as sessions_router
from app.routers.sets import router as sets_router
from app.routers.reps import router as reps_router
from app.db import SessionLocal  # for healthz DB check

log = logging.getLogger("uvicorn")

app = FastAPI(
    title="HerHealth API",
    openapi_tags=[
        {"name": "auth", "description": "Registration & login"},
        {"name": "users", "description": "User administration"},
        {"name": "sessions", "description": "Exercise sessions"},
        {"name": "sets", "description": "Exercise sets per session"},
        {"name": "reps", "description": "Repetition events per set"},
    ],
)


# CORS (relax for local dev; tighten origins in prod via env)
ALLOW_ORIGINS = os.getenv("ALLOW_ORIGINS", "*").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOW_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def add_request_id_and_log(request: Request, call_next):
    req_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
    start = time.perf_counter()
    response = await call_next(request)
    duration_ms = (time.perf_counter() - start) * 1000
    response.headers["X-Request-ID"] = req_id
    log.info("rid=%s %s %s -> %s in %.1fms",
             req_id, request.method, request.url.path, response.status_code, duration_ms)
    return response

@app.get("/")
def root():
    return {"ok": True, "name": "HerHealth API"}

@app.get("/ping")
def ping():
    return {"pong": True}

@app.get("/healthz")
def healthz():
    # Quick DB sanity check
    try:
        with SessionLocal() as db:
            db.execute("SELECT 1")
        return {"status": "ok"}
    except Exception as e:
        return {"status": "degraded", "error": str(e)}

@app.get("/version")
def version():
    return {"version": os.getenv("API_VERSION", "dev")}

# Routers
app.include_router(users_router)
app.include_router(auth_router)
app.include_router(sessions_router)
app.include_router(sets_router)
app.include_router(reps_router)
