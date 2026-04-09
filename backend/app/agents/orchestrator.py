"""Search orchestrator — ties together safety, parsing, scraping, and scoring."""

from __future__ import annotations

import asyncio
import hashlib
import time
from typing import Optional

from app.agents.safety import get_safety_filter
from app.agents.query_parser import get_query_parser
from app.agents.scorer import get_scorer
from app.models.database import get_db
from app.models.schemas import (
    SafetyLevel,
    SearchRequest,
    SearchResponse,
    SearchResult,
    ParsedQuery,
)
from app.scrapers.registry import get_registry
from app.utils.logger import log


class SearchOrchestrator:
    """
    Pipeline:
    1. Safety filter (hard block)
    2. LLM query parse
    3. Parallel scraper dispatch
    4. Safety filter on results
    5. LLM scoring & ranking
    6. Cache & return
    """

    async def search(self, req: SearchRequest) -> SearchResponse:
        t0 = time.time()

        # ── 1. Safety pre-check ──
        safety = get_safety_filter()
        level, reason = safety.check_query(req.query)
        if level == SafetyLevel.BLOCKED:
            return SearchResponse(
                query=req.query,
                parsed=ParsedQuery(original=req.query),
                results=[],
                total=0,
                page=req.page,
                per_page=req.per_page,
                sources_searched=[],
                search_time_ms=int((time.time() - t0) * 1000),
            )

        # ── 2. Check cache ──
        db = get_db()
        cache_key = hashlib.sha256(
            f"{req.query}:{req.page}:{req.per_page}:{req.sources}:{req.media_type}:{req.sort_by}".encode()
        ).hexdigest()

        cached = db.get_cached_search(cache_key, max_age_s=300)
        if cached:
            cached["search_time_ms"] = int((time.time() - t0) * 1000)
            return SearchResponse(**cached)

        # ── 3. LLM query parse ──
        parser = get_query_parser()
        parsed = await parser.parse(req.query)
        log.info("Parsed query: %s", parsed.model_dump_json())

        # ── 4. Select scrapers ──
        registry = get_registry()
        if req.sources:
            scrapers = registry.subset(req.sources)
        elif parsed.site_hints:
            scrapers = registry.subset(parsed.site_hints)
            # Always include brave as fallback
            brave = registry.get("brave")
            if brave and brave not in scrapers:
                scrapers.append(brave)
        else:
            scrapers = registry.all()

        source_ids = [s.id for s in scrapers]

        # ── 5. Parallel scrape ──
        async def _scrape(scraper):
            try:
                return await asyncio.wait_for(
                    scraper.search(parsed.keywords, page=req.page, per_page=req.per_page),
                    timeout=20,
                )
            except asyncio.TimeoutError:
                log.warning("Scraper %s timed out", scraper.id)
                return []
            except Exception as exc:
                log.warning("Scraper %s error: %s", scraper.id, exc)
                return []

        all_results_nested = await asyncio.gather(*[_scrape(s) for s in scrapers])
        all_results: list[SearchResult] = []
        for batch in all_results_nested:
            all_results.extend(batch)

        log.info("Got %d raw results from %d scrapers", len(all_results), len(scrapers))

        # ── 6. Safety filter on results ──
        if req.safe_mode:
            filtered = []
            for r in all_results:
                if safety.check_result(r.title, r.tags) != SafetyLevel.BLOCKED:
                    r.safety = SafetyLevel.SAFE
                    filtered.append(r)
                else:
                    log.debug("Filtered result: %s", r.title[:60])
            all_results = filtered

        # ── 7. Deduplicate by URL ──
        seen_urls: set[str] = set()
        deduped: list[SearchResult] = []
        for r in all_results:
            if r.url not in seen_urls:
                seen_urls.add(r.url)
                deduped.append(r)
        all_results = deduped

        # ── 8. LLM scoring ──
        scorer = get_scorer()
        scored = await scorer.score(parsed, all_results)

        # ── 9. Paginate ──
        total = len(scored)
        start = 0
        end = req.per_page
        page_results = scored[start:end]

        # ── 10. Build response ──
        elapsed_ms = int((time.time() - t0) * 1000)

        response = SearchResponse(
            query=req.query,
            parsed=parsed,
            results=page_results,
            total=total,
            page=req.page,
            per_page=req.per_page,
            sources_searched=source_ids,
            search_time_ms=elapsed_ms,
        )

        # ── 11. Cache ──
        try:
            db.set_cached_search(cache_key, req.query, response.model_dump())
            db.add_history(req.query, total)
        except Exception as exc:
            log.warning("Cache write failed: %s", exc)

        return response


_orchestrator: Optional[SearchOrchestrator] = None


def get_orchestrator() -> SearchOrchestrator:
    global _orchestrator
    if _orchestrator is None:
        _orchestrator = SearchOrchestrator()
    return _orchestrator
