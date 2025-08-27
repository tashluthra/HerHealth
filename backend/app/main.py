import os
import time
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from app.routers.auth import router as auth_router
from app.routers.users import router as users_router

from app.routers.sessions import router as sessions_router
from app.routers.sets import router as sets_router
from app.routers.reps import router as reps_router

app = FastAPI(title="HerHealth API")

# CORS (relax for local dev; tighten later)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Simple request logging so we see traffic + timings
@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    duration_ms = (time.perf_counter() - start) * 1000
    print(f"{request.method} {request.url.path} -> {response.status_code} in {duration_ms:.1f}ms")
    return response

@app.get("/ping")
def ping():
    return {"pong": True}

@app.get("/healthz")
def healthz():
    return {"status": "ok"}

@app.get("/version")
def version():
    return {"version": os.getenv("API_VERSION", "dev")}

# Register /users endpoints
app.include_router(users_router)
app.include_router(auth_router)

app.include_router(sessions_router)
app.include_router(sets_router)
app.include_router(reps_router)