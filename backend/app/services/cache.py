"""SQLite-backed result cache service."""

from __future__ import annotations

from app.models.database import get_db


def get_cached(query_hash: str, max_age: int = 300):
    return get_db().get_cached_search(query_hash, max_age)


def set_cached(query_hash: str, query: str, data: dict):
    get_db().set_cached_search(query_hash, query, data)
