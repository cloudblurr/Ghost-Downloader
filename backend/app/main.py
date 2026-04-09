"""Ghost Search — FastAPI application entry point."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import search, analyze, preferences
from app.utils.rate_limit import RateLimitMiddleware
from app.utils.logger import log


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("Ghost Search backend starting")
    # Eagerly init singletons so startup errors surface immediately
    from app.scrapers.registry import get_registry
    from app.models.database import get_db

    get_db()
    reg = get_registry()
    log.info("Registered scrapers: %s", reg.ids())
    yield
    log.info("Ghost Search backend shutting down")


app = FastAPI(
    title="Ghost Search",
    description="AI-powered privacy-first media search API",
    version="0.1.0",
    lifespan=lifespan,
)

# ── CORS ──
cfg = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=cfg.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Rate limiting ──
app.add_middleware(RateLimitMiddleware)

# ── Routers ──
app.include_router(search.router)
app.include_router(analyze.router)
app.include_router(preferences.router)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "ghost-search"}
