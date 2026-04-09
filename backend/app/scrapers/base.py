"""Abstract base class for all scrapers."""

from __future__ import annotations

import hashlib
from abc import ABC, abstractmethod
from typing import Optional

import httpx

from app.config import get_settings
from app.models.schemas import MediaType, SearchResult, SourceInfo


class BaseScraper(ABC):
    """Every scraper implements this interface."""

    id: str = "base"
    name: str = "Base"
    description: str = ""
    media_types: list[MediaType] = [MediaType.VIDEO]

    def __init__(self):
        cfg = get_settings()
        self.timeout = cfg.SCRAPER_TIMEOUT
        self.max_results = cfg.MAX_RESULTS_PER_SCRAPER
        self.ua = cfg.USER_AGENT

    @property
    def info(self) -> SourceInfo:
        return SourceInfo(id=self.id, name=self.name, description=self.description, media_types=self.media_types)

    def _client(self, **kwargs) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            timeout=self.timeout,
            headers={"User-Agent": self.ua},
            follow_redirects=True,
            **kwargs,
        )

    @staticmethod
    def _make_id(source: str, raw: str) -> str:
        return hashlib.sha256(f"{source}:{raw}".encode()).hexdigest()[:16]

    @abstractmethod
    async def search(self, keywords: list[str], page: int = 1, per_page: int = 20) -> list[SearchResult]:
        """Return search results for the given keywords."""
        ...

    async def health(self) -> bool:
        """Quick connectivity check."""
        return True
