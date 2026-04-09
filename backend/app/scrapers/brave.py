"""Brave Search API scraper — fallback for queries not covered by niche scrapers."""

from __future__ import annotations

from urllib.parse import urlparse

from app.config import get_settings
from app.models.schemas import MediaType, SearchResult
from app.scrapers.base import BaseScraper
from app.utils.logger import log


class BraveSearchScraper(BaseScraper):
    id = "brave"
    name = "Brave Search"
    description = "Brave Search API — web-wide fallback for broad queries"
    media_types = [MediaType.VIDEO, MediaType.IMAGE]

    API = "https://api.search.brave.com/res/v1/web/search"

    async def search(self, keywords: list[str], page: int = 1, per_page: int = 20) -> list[SearchResult]:
        cfg = get_settings()
        if not cfg.BRAVE_API_KEY:
            return []

        query = " ".join(keywords)
        results: list[SearchResult] = []
        offset = (page - 1) * per_page

        try:
            async with self._client() as client:
                resp = await client.get(
                    self.API,
                    params={"q": query, "count": min(per_page, 20), "offset": offset, "safesearch": "off"},
                    headers={"X-Subscription-Token": cfg.BRAVE_API_KEY, "Accept": "application/json"},
                )
                resp.raise_for_status()
                data = resp.json()

            web_results = data.get("web", {}).get("results", [])

            for item in web_results[: self.max_results]:
                url = item.get("url", "")
                domain = urlparse(url).hostname or ""
                thumb = None
                if item.get("thumbnail", {}).get("src"):
                    thumb = item["thumbnail"]["src"]

                is_video = any(ext in url.lower() for ext in [".mp4", ".webm", ".mov"])
                is_video = is_video or any(
                    s in domain for s in ["pornhub", "xvideos", "redtube", "xhamster", "erome", "redgifs"]
                )

                results.append(
                    SearchResult(
                        id=self._make_id("brave", url),
                        source="brave",
                        title=item.get("title", "")[:200],
                        url=url,
                        thumbnail=thumb,
                        media_type=MediaType.VIDEO if is_video else MediaType.IMAGE,
                        tags=[],
                        date=item.get("page_age"),
                    )
                )
        except Exception as exc:
            log.warning("Brave search failed: %s", exc)

        return results
