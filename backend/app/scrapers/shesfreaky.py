"""ShesFreaky video search scraper."""

from __future__ import annotations

from bs4 import BeautifulSoup

from app.models.schemas import MediaType, SearchResult
from app.scrapers.base import BaseScraper
from app.utils.logger import log


class ShesFreakyScraper(BaseScraper):
    id = "shesfreaky"
    name = "ShesFreaky"
    description = "ShesFreaky amateur video search scraper"
    media_types = [MediaType.VIDEO]

    BASE = "https://www.shesfreaky.com"

    async def search(self, keywords: list[str], page: int = 1, per_page: int = 20) -> list[SearchResult]:
        query = " ".join(keywords)
        url = f"{self.BASE}/searchgatev2.php?mode=search&type=videos&q={query}&page={page}"
        results: list[SearchResult] = []

        try:
            async with self._client() as client:
                resp = await client.get(
                    url,
                    headers={"Referer": self.BASE + "/"},
                )
                resp.raise_for_status()

            soup = BeautifulSoup(resp.text, "html.parser")
            items = soup.select("div.item")

            seen_urls: set[str] = set()
            for item in items[: self.max_results]:
                link_el = item.select_one("a[href*='/video/']")
                if not link_el:
                    continue
                href = link_el.get("href", "")
                if not href.startswith("http"):
                    href = self.BASE + href
                if href in seen_urls:
                    continue
                seen_urls.add(href)

                title_el = item.select_one("div.item-title a")
                title = title_el.get_text(strip=True) if title_el else "ShesFreaky Video"

                thumb_el = item.select_one("img")
                thumb = None
                if thumb_el:
                    thumb = thumb_el.get("src") or thumb_el.get("data-src")
                    if thumb and thumb.startswith("//"):
                        thumb = "https:" + thumb

                views = None
                views_el = item.select_one("span.thumb-views")
                if views_el:
                    views_text = views_el.get_text(strip=True).replace(",", "").replace("views", "").strip()
                    try:
                        views = int(views_text)
                    except ValueError:
                        pass

                duration = None
                dur_el = item.select_one("span.thumb-length")
                if dur_el:
                    dur_text = dur_el.get_text(strip=True)
                    duration = self._parse_duration(dur_text)

                results.append(
                    SearchResult(
                        id=self._make_id("shesfreaky", href),
                        source="shesfreaky",
                        title=title,
                        url=href,
                        thumbnail=thumb,
                        media_type=MediaType.VIDEO,
                        duration=duration,
                        views=views,
                        tags=[k.lower() for k in keywords],
                    )
                )
        except Exception as exc:
            log.warning("ShesFreaky search failed: %s", exc)

        return results

    @staticmethod
    def _parse_duration(text: str) -> int | None:
        import re

        m = re.search(r"(\d+):(\d+):(\d+)", text)
        if m:
            return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + int(m.group(3))
        m = re.search(r"(\d+):(\d+)", text)
        if m:
            return int(m.group(1)) * 60 + int(m.group(2))
        return None
