"""XVideos web-scraping search."""

from __future__ import annotations

import re
from urllib.parse import quote_plus

from bs4 import BeautifulSoup

from app.models.schemas import MediaType, SearchResult
from app.scrapers.base import BaseScraper
from app.utils.logger import log


class XVideosScraper(BaseScraper):
    id = "xvideos"
    name = "XVideos"
    description = "XVideos video search via web scraping"
    media_types = [MediaType.VIDEO]

    BASE = "https://www.xvideos.com"

    @staticmethod
    def _parse_duration(text: str) -> int | None:
        text = text.strip().lower().replace("min", "").replace("sec", "").replace("h", ":")
        parts = text.strip().split(":")
        try:
            parts = [int(p.strip()) for p in parts if p.strip()]
            if len(parts) == 1:
                return parts[0] * 60
            if len(parts) == 2:
                return parts[0] * 60 + parts[1]
            if len(parts) == 3:
                return parts[0] * 3600 + parts[1] * 60 + parts[2]
        except ValueError:
            pass
        return None

    async def search(self, keywords: list[str], page: int = 1, per_page: int = 20) -> list[SearchResult]:
        query = quote_plus(" ".join(keywords))
        p = page - 1  # 0-indexed
        url = f"{self.BASE}/?k={query}&p={p}"
        results: list[SearchResult] = []

        try:
            async with self._client() as client:
                resp = await client.get(url)
                resp.raise_for_status()

            soup = BeautifulSoup(resp.text, "html.parser")
            thumbs = soup.select("div.thumb-block")

            for block in thumbs[: self.max_results]:
                link = block.select_one("a[href]")
                if not link:
                    continue
                href = link.get("href", "")
                if not href.startswith("http"):
                    href = self.BASE + href

                title = block.select_one("p.title a")
                title_text = title.get("title", "") if title else link.get("title", "")

                img = block.select_one("img")
                thumb = None
                if img:
                    thumb = img.get("data-src") or img.get("src")

                dur_el = block.select_one(".duration")
                duration = self._parse_duration(dur_el.get_text()) if dur_el else None

                metadata_el = block.select_one(".metadata")
                views = None
                if metadata_el:
                    m = re.search(r"([\d,.]+[kKmM]?)\s*(?:views?|hits?)", metadata_el.get_text())
                    if m:
                        raw = m.group(1).replace(",", "").replace(".", "").lower()
                        try:
                            if raw.endswith("k"):
                                views = int(float(raw[:-1]) * 1_000)
                            elif raw.endswith("m"):
                                views = int(float(raw[:-1]) * 1_000_000)
                            else:
                                views = int(raw)
                        except ValueError:
                            pass

                results.append(
                    SearchResult(
                        id=self._make_id("xvideos", href),
                        source="xvideos",
                        title=title_text[:200],
                        url=href,
                        thumbnail=thumb,
                        media_type=MediaType.VIDEO,
                        duration=duration,
                        views=views,
                    )
                )
        except Exception as exc:
            log.warning("XVideos search failed: %s", exc)

        return results
