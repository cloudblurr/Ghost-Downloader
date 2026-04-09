"""RedGifs scraper using their public API."""

from __future__ import annotations

from app.models.schemas import MediaType, SearchResult
from app.scrapers.base import BaseScraper
from app.utils.logger import log


class RedGifsScraper(BaseScraper):
    id = "redgifs"
    name = "RedGifs"
    description = "RedGifs GIF/video search via API"
    media_types = [MediaType.VIDEO, MediaType.GIF]

    API = "https://api.redgifs.com/v2"

    async def _get_token(self, client) -> str:
        resp = await client.get(f"{self.API}/auth/temporary")
        resp.raise_for_status()
        return resp.json()["token"]

    async def search(self, keywords: list[str], page: int = 1, per_page: int = 20) -> list[SearchResult]:
        query = " ".join(keywords)
        results: list[SearchResult] = []

        try:
            async with self._client() as client:
                token = await self._get_token(client)
                resp = await client.get(
                    f"{self.API}/gifs/search",
                    params={"search_text": query, "page": page, "count": min(per_page, 80), "order": "best"},
                    headers={"Authorization": f"Bearer {token}"},
                )
                resp.raise_for_status()
                data = resp.json()

            for gif in data.get("gifs", [])[: self.max_results]:
                hd = gif.get("urls", {}).get("hd") or gif.get("urls", {}).get("sd", "")
                thumb = gif.get("urls", {}).get("thumbnail", "")
                results.append(
                    SearchResult(
                        id=self._make_id("redgifs", gif.get("id", "")),
                        source="redgifs",
                        title=gif.get("id", "RedGifs clip"),
                        url=f"https://www.redgifs.com/watch/{gif.get('id', '')}",
                        thumbnail=thumb,
                        preview_url=hd,
                        media_type=MediaType.GIF,
                        duration=gif.get("duration"),
                        views=gif.get("views"),
                        tags=gif.get("tags", []),
                        performers=[gif.get("userName", "")] if gif.get("userName") else [],
                    )
                )
        except Exception as exc:
            log.warning("RedGifs search failed: %s", exc)

        return results
