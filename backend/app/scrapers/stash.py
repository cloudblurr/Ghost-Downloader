"""Stash and ThePornDB GraphQL scrapers for metadata enrichment."""

from __future__ import annotations

from app.config import get_settings
from app.models.schemas import MediaType, SearchResult
from app.scrapers.base import BaseScraper
from app.utils.logger import log


class StashScraper(BaseScraper):
    """Queries a local or remote Stash instance via its GraphQL API."""

    id = "stash"
    name = "Stash"
    description = "Stash-box / local Stash GraphQL metadata search"
    media_types = [MediaType.VIDEO, MediaType.IMAGE]

    FIND_SCENES_QUERY = """
    query FindScenes($filter: FindFilterType!) {
      findScenes(filter: $filter) {
        count
        scenes {
          id
          title
          details
          url
          date
          rating100
          paths { screenshot }
          tags { name }
          performers { name }
          files { duration }
        }
      }
    }
    """

    async def search(self, keywords: list[str], page: int = 1, per_page: int = 20) -> list[SearchResult]:
        cfg = get_settings()
        if not cfg.STASH_API_URL:
            return []

        query = " ".join(keywords)
        results: list[SearchResult] = []

        try:
            async with self._client() as client:
                headers = {}
                if cfg.STASH_API_KEY:
                    headers["ApiKey"] = cfg.STASH_API_KEY

                resp = await client.post(
                    cfg.STASH_API_URL,
                    json={
                        "query": self.FIND_SCENES_QUERY,
                        "variables": {
                            "filter": {
                                "q": query,
                                "page": page,
                                "per_page": min(per_page, 40),
                                "sort": "date",
                                "direction": "DESC",
                            }
                        },
                    },
                    headers=headers,
                )
                resp.raise_for_status()
                data = resp.json()

            scenes = data.get("data", {}).get("findScenes", {}).get("scenes", [])

            for s in scenes[: self.max_results]:
                duration = None
                if s.get("files"):
                    duration = int(s["files"][0].get("duration", 0)) or None

                results.append(
                    SearchResult(
                        id=self._make_id("stash", str(s["id"])),
                        source="stash",
                        title=s.get("title", "Untitled"),
                        url=s.get("url", ""),
                        thumbnail=s.get("paths", {}).get("screenshot"),
                        media_type=MediaType.VIDEO,
                        duration=duration,
                        rating=s.get("rating100", 0) / 100 if s.get("rating100") else None,
                        tags=[t["name"] for t in s.get("tags", [])],
                        performers=[p["name"] for p in s.get("performers", [])],
                        date=s.get("date"),
                    )
                )
        except Exception as exc:
            log.warning("Stash search failed: %s", exc)

        return results


class ThePornDBScraper(BaseScraper):
    """Queries ThePornDB GraphQL API for metadata enrichment."""

    id = "theporndb"
    name = "ThePornDB"
    description = "ThePornDB scene metadata search via GraphQL"
    media_types = [MediaType.VIDEO]

    SEARCH_QUERY = """
    query SearchScenes($q: String!, $page: Int) {
      searchScenes(query: $q, page: $page) {
        data {
          id
          title
          slug
          date
          duration
          poster
          url
          performers { name }
          tags { name }
          site { name }
        }
      }
    }
    """

    async def search(self, keywords: list[str], page: int = 1, per_page: int = 20) -> list[SearchResult]:
        cfg = get_settings()
        if not cfg.THEPORNDB_API_KEY:
            return []

        query = " ".join(keywords)
        results: list[SearchResult] = []

        try:
            async with self._client() as client:
                resp = await client.post(
                    cfg.THEPORNDB_API_URL,
                    json={
                        "query": self.SEARCH_QUERY,
                        "variables": {"q": query, "page": page},
                    },
                    headers={"Authorization": f"Bearer {cfg.THEPORNDB_API_KEY}"},
                )
                resp.raise_for_status()
                data = resp.json()

            scenes = data.get("data", {}).get("searchScenes", {}).get("data", [])

            for s in scenes[: self.max_results]:
                results.append(
                    SearchResult(
                        id=self._make_id("theporndb", str(s.get("id", ""))),
                        source="theporndb",
                        title=s.get("title", ""),
                        url=s.get("url", "") or f"https://theporndb.net/scenes/{s.get('slug', '')}",
                        thumbnail=s.get("poster"),
                        media_type=MediaType.VIDEO,
                        duration=s.get("duration"),
                        tags=[t["name"] for t in s.get("tags", [])],
                        performers=[p["name"] for p in s.get("performers", [])],
                        date=s.get("date"),
                    )
                )
        except Exception as exc:
            log.warning("ThePornDB search failed: %s", exc)

        return results
