"""LLM-powered query parser — converts natural language into structured search params."""

from __future__ import annotations

import json
from typing import Optional

from langchain_groq import ChatGroq
from langchain_core.messages import SystemMessage, HumanMessage

from app.config import get_settings
from app.models.schemas import ParsedQuery, MediaType
from app.utils.logger import log

SYSTEM_PROMPT = """\
You are Ghost Search's query parser. Given a user's natural-language search query,
extract structured fields. Respond with ONLY valid JSON matching this schema:

{
  "keywords": ["keyword1", "keyword2"],
  "performers": ["name1"],
  "tags": ["tag1", "tag2"],
  "site_hints": ["erome", "redgifs"],
  "media_type": "video" | "image" | "gallery" | "gif" | null,
  "intent": "search" | "lookup_performer" | "lookup_scene"
}

Rules:
- keywords: core search terms, cleaned of filler words
- performers: any performer / model / creator names detected
- tags: descriptive tags (body type, act, category, etc.)
- site_hints: if the user mentions a platform name, include the scraper ID
  (erome, redgifs, pornhub, xvideos, stash, theporndb, brave)
- media_type: null if unspecified
- intent: what the user is trying to do
- Be concise; don't invent data not present in the query
"""


class QueryParser:
    def __init__(self):
        cfg = get_settings()
        self._llm = ChatGroq(
            api_key=cfg.GROQ_API_KEY,
            model=cfg.GROQ_MODEL,
            temperature=cfg.GROQ_TEMPERATURE,
            max_tokens=1024,
        ) if cfg.GROQ_API_KEY else None

    async def parse(self, query: str) -> ParsedQuery:
        """Parse a natural-language query into structured fields via LLM, with fallback."""
        if not self._llm:
            return self._fallback_parse(query)

        try:
            resp = await self._llm.ainvoke([
                SystemMessage(content=SYSTEM_PROMPT),
                HumanMessage(content=query),
            ])
            raw = resp.content.strip()

            # Strip markdown code fences if present
            if raw.startswith("```"):
                raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
                if raw.endswith("```"):
                    raw = raw[:-3]
                raw = raw.strip()

            parsed = json.loads(raw)

            media_type = None
            if parsed.get("media_type"):
                try:
                    media_type = MediaType(parsed["media_type"])
                except ValueError:
                    pass

            return ParsedQuery(
                original=query,
                keywords=parsed.get("keywords", query.split()),
                performers=parsed.get("performers", []),
                tags=parsed.get("tags", []),
                site_hints=parsed.get("site_hints", []),
                media_type=media_type,
                intent=parsed.get("intent", "search"),
            )
        except Exception as exc:
            log.warning("LLM query parse failed, using fallback: %s", exc)
            return self._fallback_parse(query)

    @staticmethod
    def _fallback_parse(query: str) -> ParsedQuery:
        """Simple keyword split when LLM is unavailable."""
        words = query.lower().split()
        site_map = {
            "erome": "erome", "redgifs": "redgifs", "pornhub": "pornhub",
            "xvideos": "xvideos", "stash": "stash",
        }
        site_hints = [site_map[w] for w in words if w in site_map]
        keywords = [w for w in words if w not in site_map and len(w) > 1]
        return ParsedQuery(original=query, keywords=keywords or words, site_hints=site_hints)


_parser: Optional[QueryParser] = None


def get_query_parser() -> QueryParser:
    global _parser
    if _parser is None:
        _parser = QueryParser()
    return _parser
