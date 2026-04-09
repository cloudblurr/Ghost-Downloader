"""LLM-powered relevance/quality scorer. Runs after scrapers return raw results."""

from __future__ import annotations

import json
from typing import Optional

from langchain_groq import ChatGroq
from langchain_core.messages import SystemMessage, HumanMessage

from app.config import get_settings
from app.models.schemas import SearchResult, ParsedQuery
from app.utils.logger import log


SYSTEM_PROMPT = """\
You are Ghost Search's result scorer. Given a parsed search query and a batch of
search results, score each result for relevance and quality.

Respond with ONLY a JSON array. Each element must have:
{
  "id": "<the result id>",
  "relevance_score": 0.0-1.0,
  "quality_score": 0.0-1.0
}

Scoring guidelines:
- relevance_score: how well the result matches the user's intent, keywords, performers, tags
- quality_score: infer from title clarity, known good sources, metadata completeness, view counts
- A title that exactly matches multiple keywords → higher relevance
- Known premium sites (e.g. ThePornDB, Stash matches) get quality boost
- Results with missing title/thumbnail get quality penalty
- Be strict: most results should be 0.3-0.7, only exceptional matches get >0.8
"""

# Maximum results to send to LLM per batch (to stay within token limits)
BATCH_SIZE = 25


class ResultScorer:
    def __init__(self):
        cfg = get_settings()
        self._llm = ChatGroq(
            api_key=cfg.GROQ_API_KEY,
            model=cfg.GROQ_MODEL,
            temperature=0.0,
            max_tokens=cfg.GROQ_MAX_TOKENS,
        ) if cfg.GROQ_API_KEY else None

    async def score(self, parsed: ParsedQuery, results: list[SearchResult]) -> list[SearchResult]:
        """Score and re-rank results using LLM, with fallback heuristics."""
        if not self._llm or len(results) == 0:
            return self._fallback_score(parsed, results)

        try:
            # Build compact representation for LLM
            items = []
            for r in results[:BATCH_SIZE]:
                items.append({
                    "id": r.id,
                    "source": r.source,
                    "title": r.title[:100],
                    "tags": r.tags[:5],
                    "performers": r.performers[:3],
                    "views": r.views,
                    "rating": r.rating,
                    "has_thumb": r.thumbnail is not None,
                })

            query_repr = json.dumps({
                "keywords": parsed.keywords,
                "performers": parsed.performers,
                "tags": parsed.tags,
                "intent": parsed.intent,
            })

            prompt = f"Query: {query_repr}\n\nResults:\n{json.dumps(items)}"

            resp = await self._llm.ainvoke([
                SystemMessage(content=SYSTEM_PROMPT),
                HumanMessage(content=prompt),
            ])

            raw = resp.content.strip()
            if raw.startswith("```"):
                raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
                if raw.endswith("```"):
                    raw = raw[:-3]
                raw = raw.strip()

            scores = json.loads(raw)
            score_map = {s["id"]: s for s in scores}

            for r in results:
                if r.id in score_map:
                    r.relevance_score = max(0, min(1, score_map[r.id].get("relevance_score", 0.5)))
                    r.quality_score = max(0, min(1, score_map[r.id].get("quality_score", 0.5)))

            # Sort by combined score
            results.sort(key=lambda r: (r.relevance_score * 0.7 + r.quality_score * 0.3), reverse=True)
            return results

        except Exception as exc:
            log.warning("LLM scoring failed, using fallback: %s", exc)
            return self._fallback_score(parsed, results)

    @staticmethod
    def _fallback_score(parsed: ParsedQuery, results: list[SearchResult]) -> list[SearchResult]:
        """Heuristic scoring when LLM is unavailable."""
        keywords_lower = {k.lower() for k in parsed.keywords}
        performer_lower = {p.lower() for p in parsed.performers}

        for r in results:
            title_lower = r.title.lower()

            # Relevance: keyword match ratio
            matched = sum(1 for kw in keywords_lower if kw in title_lower)
            r.relevance_score = min(1.0, matched / max(len(keywords_lower), 1))

            # Performer boost
            if performer_lower:
                perf_match = sum(1 for p in performer_lower if p in title_lower or p in [x.lower() for x in r.performers])
                r.relevance_score = min(1.0, r.relevance_score + perf_match * 0.3)

            # Quality heuristics
            q = 0.4
            if r.thumbnail:
                q += 0.1
            if r.views and r.views > 10000:
                q += 0.1
            if r.rating and r.rating > 0.7:
                q += 0.1
            if r.source in ("stash", "theporndb"):
                q += 0.15
            r.quality_score = min(1.0, q)

        results.sort(key=lambda r: (r.relevance_score * 0.7 + r.quality_score * 0.3), reverse=True)
        return results


_scorer: Optional[ResultScorer] = None


def get_scorer() -> ResultScorer:
    global _scorer
    if _scorer is None:
        _scorer = ResultScorer()
    return _scorer
