"""Hard pre-LLM safety filter — blocks illegal content queries before they ever reach the AI."""

from __future__ import annotations

import re
from app.models.schemas import SafetyLevel
from app.utils.logger import log

# ── Absolute blocklist — these patterns indicate illegal/non-consensual content ──
# This is a hard filter; no LLM bypass possible.
_BLOCKED_PATTERNS: list[re.Pattern] = [
    re.compile(p, re.IGNORECASE)
    for p in [
        r"\b(?:child|kid|minor|underage|preteen|toddler|infant|baby|pedo|paedo)\b",
        r"\b(?:cp|csam|pthc|jb|jailbait|lolita|shota|shotacon|lolicon)\b",
        r"\b(?:rape|forced|non.?consent|drugged|unconscious|asleep|roofie|chloroform)\b",
        r"\b(?:bestiality|zoophilia|animal.?sex|dog.?sex|horse.?sex)\b",
        r"\b(?:snuff|gore|necro|necrophilia|murder.?porn|death.?porn)\b",
        r"\b(?:revenge.?porn|leaked.?nudes|stolen.?nudes|creepshot|hidden.?cam|spy.?cam)\b",
        r"\b(?:deep.?fake|deepfake)\b",
        r"\b(?:incest|molest)\b",
    ]
]


class SafetyFilter:
    """Pre-LLM hard safety filter. Returns BLOCKED for any query matching illegal patterns."""

    def check_query(self, query: str) -> tuple[SafetyLevel, str]:
        """
        Returns (SafetyLevel, reason).
        BLOCKED  = must not proceed
        SAFE     = proceed normally
        """
        for pattern in _BLOCKED_PATTERNS:
            if pattern.search(query):
                reason = f"Query blocked by safety filter (matched: {pattern.pattern})"
                log.warning("SAFETY BLOCK: query=%r reason=%s", query[:80], reason)
                return SafetyLevel.BLOCKED, reason

        return SafetyLevel.SAFE, ""

    def check_result(self, title: str, tags: list[str]) -> SafetyLevel:
        """Check a single search result's title + tags for blocked content."""
        combined = title + " " + " ".join(tags)
        for pattern in _BLOCKED_PATTERNS:
            if pattern.search(combined):
                return SafetyLevel.BLOCKED
        return SafetyLevel.SAFE


_filter: SafetyFilter | None = None


def get_safety_filter() -> SafetyFilter:
    global _filter
    if _filter is None:
        _filter = SafetyFilter()
    return _filter
