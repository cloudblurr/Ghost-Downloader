"""Centralized configuration loaded from environment variables."""

from __future__ import annotations

import os
from pathlib import Path
from functools import lru_cache

from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)


class Settings:
    # ── LLM ──
    GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")
    GROQ_MODEL: str = os.getenv("GROQ_MODEL", "meta-llama/llama-4-maverick-17b-128e-instruct")
    GROQ_TEMPERATURE: float = float(os.getenv("GROQ_TEMPERATURE", "0.1"))
    GROQ_MAX_TOKENS: int = int(os.getenv("GROQ_MAX_TOKENS", "4096"))

    # ── Brave Search ──
    BRAVE_API_KEY: str = os.getenv("BRAVE_API_KEY", "")

    # ── Stash / ThePornDB ──
    STASH_API_URL: str = os.getenv("STASH_API_URL", "")
    STASH_API_KEY: str = os.getenv("STASH_API_KEY", "")
    THEPORNDB_API_URL: str = os.getenv("THEPORNDB_API_URL", "https://theporndb.net/graphql")
    THEPORNDB_API_KEY: str = os.getenv("THEPORNDB_API_KEY", "")

    # ── Database ──
    SQLITE_PATH: str = str(DATA_DIR / "ghost_search.db")
    CHROMA_PATH: str = str(DATA_DIR / "chroma")
    ENABLE_VECTOR_DB: bool = os.getenv("ENABLE_VECTOR_DB", "false").lower() == "true"

    # ── Server ──
    CORS_ORIGINS: list[str] = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:3333").split(",")
    RATE_LIMIT_RPM: int = int(os.getenv("RATE_LIMIT_RPM", "30"))
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")

    # ── Scraper defaults ──
    SCRAPER_TIMEOUT: int = int(os.getenv("SCRAPER_TIMEOUT", "15"))
    MAX_RESULTS_PER_SCRAPER: int = int(os.getenv("MAX_RESULTS_PER_SCRAPER", "20"))
    USER_AGENT: str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
