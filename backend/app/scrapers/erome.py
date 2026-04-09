"""Erome album/search scraper."""

from __future__ import annotations

from bs4 import BeautifulSoup

from app.models.schemas import MediaType, SearchResult
from app.scrapers.base import BaseScraper
from app.utils.logger import log


class EromeScraper(BaseScraper):
    id = "erome"
    name = "Erome"
    description = "Erome album and search scraper"
    media_types = [MediaType.VIDEO, MediaType.IMAGE, MediaType.GALLERY]

    BASE = "https://www.erome.com"

    async def search(self, keywords: list[str], page: int = 1, per_page: int = 20) -> list[SearchResult]:
        query = "+".join(keywords)
        url = f"{self.BASE}/search?q={query}&page={page}"
        results: list[SearchResult] = []

        try:
            async with self._client() as client:
                resp = await client.get(url, headers={"Referer": self.BASE + "/"})
                resp.raise_for_status()

            soup = BeautifulSoup(resp.text, "html.parser")
            albums = soup.select("div.album")

            for album in albums[: self.max_results]:
                link_el = album.select_one("a[href]")
                if not link_el:
                    continue
                href = link_el.get("href", "")
                if not href.startswith("http"):
                    href = self.BASE + href

                title_el = album.select_one("h2") or album.select_one(".album-title")
                title = title_el.get_text(strip=True) if title_el else "Erome Album"

                thumb_el = album.select_one("img")
                thumb = None
                if thumb_el:
                    thumb = thumb_el.get("data-src") or thumb_el.get("src")

                results.append(
                    SearchResult(
                        id=self._make_id("erome", href),
                        source="erome",
                        title=title,
                        url=href,
                        thumbnail=thumb,
                        media_type=MediaType.GALLERY,
                        tags=[k.lower() for k in keywords],
                    )
                )
        except Exception as exc:
            log.warning("Erome search failed: %s", exc)

        return results
