"""Pornhub web-scraping search (no official API)."""

from __future__ import annotations

import re
from urllib.parse import quote_plus

from bs4 import BeautifulSoup

from app.models.schemas import MediaType, SearchResult
from app.scrapers.base import BaseScraper
from app.utils.logger import log


class PornhubScraper(BaseScraper):
    id = "pornhub"
    name = "Pornhub"
    description = "Pornhub video search via web scraping"
    media_types = [MediaType.VIDEO]

    BASE = "https://www.pornhub.com"

    @staticmethod
    def _parse_duration(text: str) -> int | None:
        """Convert '12:34' or '1:02:30' to seconds."""
        parts = text.strip().split(":")
        try:
            if len(parts) == 2:
                return int(parts[0]) * 60 + int(parts[1])
            if len(parts) == 3:
                return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
        except ValueError:
            pass
        return None

    @staticmethod
    def _parse_views(text: str) -> int | None:
        text = text.strip().lower().replace(",", "").replace(" ", "")
        text = re.sub(r"views?$", "", text)
        try:
            if text.endswith("k"):
                return int(float(text[:-1]) * 1_000)
            if text.endswith("m"):
                return int(float(text[:-1]) * 1_000_000)
            return int(text)
        except (ValueError, IndexError):
            return None

    async def search(self, keywords: list[str], page: int = 1, per_page: int = 20) -> list[SearchResult]:
        query = quote_plus(" ".join(keywords))
        url = f"{self.BASE}/video/search?search={query}&page={page}"
        results: list[SearchResult] = []

        try:
            async with self._client() as client:
                resp = await client.get(url)
                resp.raise_for_status()

            soup = BeautifulSoup(resp.text, "html.parser")
            items = soup.select("li.videoBox, li.pcVideoListItem, div.phimage")

            for item in items[: self.max_results]:
                link = item.select_one("a[href*='/view_video']")
                if not link:
                    continue
                href = link.get("href", "")
                if not href.startswith("http"):
                    href = self.BASE + href

                title = link.get("title", "") or link.get_text(strip=True)

                img = item.select_one("img")
                thumb = None
                if img:
                    thumb = img.get("data-thumb_url") or img.get("data-src") or img.get("src")

                dur_el = item.select_one(".duration, .marker-overlays var")
                duration = self._parse_duration(dur_el.get_text()) if dur_el else None

                views_el = item.select_one(".views var, span.views")
                views = self._parse_views(views_el.get_text()) if views_el else None

                rating_el = item.select_one(".value, .rating-container .value")
                rating = None
                if rating_el:
                    try:
                        rating = float(rating_el.get_text().replace("%", "").strip()) / 100
                    except ValueError:
                        pass

                results.append(
                    SearchResult(
                        id=self._make_id("pornhub", href),
                        source="pornhub",
                        title=title[:200],
                        url=href,
                        thumbnail=thumb,
                        media_type=MediaType.VIDEO,
                        duration=duration,
                        views=views,
                        rating=rating,
                    )
                )
        except Exception as exc:
            log.warning("Pornhub search failed: %s", exc)

        return results
