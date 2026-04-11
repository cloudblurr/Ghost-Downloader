"""Scraper registry — single import to get all scrapers."""

from __future__ import annotations

from typing import Optional

from app.models.schemas import SourceInfo
from app.scrapers.base import BaseScraper
from app.scrapers.erome import EromeScraper
from app.scrapers.redgifs import RedGifsScraper
from app.scrapers.pornhub import PornhubScraper
from app.scrapers.xvideos import XVideosScraper
from app.scrapers.xhamster import XHamsterScraper
from app.scrapers.shesfreaky import ShesFreakyScraper
from app.scrapers.stash import StashScraper, ThePornDBScraper
from app.scrapers.brave import BraveSearchScraper
from app.utils.logger import log


class ScraperRegistry:
    """Holds all registered scrapers, keyed by ID."""

    def __init__(self):
        self._scrapers: dict[str, BaseScraper] = {}
        self._register_defaults()

    def _register_defaults(self):
        for cls in [
            EromeScraper,
            RedGifsScraper,
            PornhubScraper,
            XVideosScraper,
            XHamsterScraper,
            ShesFreakyScraper,
            StashScraper,
            ThePornDBScraper,
            BraveSearchScraper,
        ]:
            try:
                inst = cls()
                self._scrapers[inst.id] = inst
                log.debug("Registered scraper: %s", inst.id)
            except Exception as exc:
                log.warning("Failed to register %s: %s", cls.__name__, exc)

    def register(self, scraper: BaseScraper):
        self._scrapers[scraper.id] = scraper

    def get(self, scraper_id: str) -> Optional[BaseScraper]:
        return self._scrapers.get(scraper_id)

    def all(self) -> list[BaseScraper]:
        return list(self._scrapers.values())

    def ids(self) -> list[str]:
        return list(self._scrapers.keys())

    def info(self) -> list[SourceInfo]:
        return [s.info for s in self._scrapers.values()]

    def subset(self, ids: list[str]) -> list[BaseScraper]:
        return [self._scrapers[i] for i in ids if i in self._scrapers]


_registry: Optional[ScraperRegistry] = None


def get_registry() -> ScraperRegistry:
    global _registry
    if _registry is None:
        _registry = ScraperRegistry()
    return _registry
