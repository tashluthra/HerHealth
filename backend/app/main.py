import logging
from time import time
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from .settings import get_settings


logger = logging.getLogger("uvicorn.access")

app = FastAPI(title="HerHealth API")

@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time()
    response = await call_next(request)
    duration_ms = int((time() - start) * 1000)
    logger.info(f"{request.method} {request.url.path} -> {response.status_code} ({duration_ms}ms)")
    return response

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

@app.get("/healthz")
def healthz():
    return {"ok": True}

@app.get("/version")
def version():
    return {"version": "0.1.0"}
