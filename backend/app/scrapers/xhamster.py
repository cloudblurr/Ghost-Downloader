"""xHamster web-scraping search."""

from __future__ import annotations

import re
from urllib.parse import quote_plus

from bs4 import BeautifulSoup

from app.models.schemas import MediaType, SearchResult
from app.scrapers.base import BaseScraper
from app.utils.logger import log


class XHamsterScraper(BaseScraper):
    id = "xhamster"
    name = "xHamster"
    description = "xHamster video search via web scraping"
    media_types = [MediaType.VIDEO]

    BASE = "https://xhamster.com"

    @staticmethod
    def _parse_duration(text: str) -> int | None:
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
        url = f"{self.BASE}/search/{query}"
        if page > 1:
            url += f"?page={page}"
        results: list[SearchResult] = []

        try:
            async with self._client() as client:
                resp = await client.get(url)
                resp.raise_for_status()

            soup = BeautifulSoup(resp.text, "html.parser")

            # xHamster uses server-rendered thumb blocks
            items = soup.select(
                "div.thumb-list__item, div.video-thumb, article.thumb"
            )

            for item in items[: self.max_results]:
                # URL + title
                link = item.select_one("a.thumb-image-container, a[href*='/videos/']")
                if not link:
                    link = item.select_one("a[href]")
                if not link:
                    continue

                href = link.get("href", "")
                if not href.startswith("http"):
                    href = self.BASE + href

                # Skip non-video pages
                if "/videos/" not in href and "/video/" not in href:
                    continue

                title_el = item.select_one(
                    "a.video-thumb-info__name, span.video-thumb-info__name, "
                    "p.video-thumb-info__name, a[class*='title'], span[class*='title']"
                )
                title = ""
                if title_el:
                    title = title_el.get_text(strip=True)
                if not title:
                    title = link.get("title", "") or link.get_text(strip=True)

                # Thumbnail
                img = item.select_one("img")
                thumb = None
                if img:
                    thumb = (
                        img.get("data-src")
                        or img.get("data-thumb_url")
                        or img.get("src")
                    )

                # Duration
                dur_el = item.select_one(
                    "span.thumb-image-container__duration, "
                    "span[class*='duration'], div[class*='duration']"
                )
                duration = self._parse_duration(dur_el.get_text()) if dur_el else None

                # Views
                views_el = item.select_one(
                    "span[class*='views'], div[class*='views'], "
                    "span.video-thumb-views, div.video-thumb-views"
                )
                views = self._parse_views(views_el.get_text()) if views_el else None

                results.append(
                    SearchResult(
                        id=self._make_id("xhamster", href),
                        source="xhamster",
                        title=title[:200],
                        url=href,
                        thumbnail=thumb,
                        media_type=MediaType.VIDEO,
                        duration=duration,
                        views=views,
                    )
                )
        except Exception as exc:
            log.warning("xHamster search failed: %s", exc)

        return results
