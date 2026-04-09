"""SQLite database for caching search results and user preferences."""

from __future__ import annotations

import json
import sqlite3
import time
from contextlib import contextmanager
from typing import Optional

from app.config import get_settings


_DB_INIT_SQL = """
CREATE TABLE IF NOT EXISTS search_cache (
    query_hash TEXT PRIMARY KEY,
    query      TEXT NOT NULL,
    response   TEXT NOT NULL,
    created_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS user_preferences (
    id              TEXT PRIMARY KEY DEFAULT 'default',
    preferred_sources TEXT DEFAULT '[]',
    blocked_tags      TEXT DEFAULT '[]',
    preferred_tags    TEXT DEFAULT '[]',
    safe_mode         INTEGER DEFAULT 1,
    default_sort      TEXT DEFAULT 'relevance',
    default_per_page  INTEGER DEFAULT 20,
    updated_at        REAL
);

CREATE TABLE IF NOT EXISTS search_history (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    query      TEXT NOT NULL,
    results_ct INTEGER DEFAULT 0,
    created_at REAL NOT NULL
);
"""


class Database:
    def __init__(self):
        self._path = get_settings().SQLITE_PATH
        self._ensure_tables()

    def _ensure_tables(self):
        with self._conn() as conn:
            conn.executescript(_DB_INIT_SQL)

    @contextmanager
    def _conn(self):
        conn = sqlite3.connect(self._path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    # ── Cache ──

    def get_cached_search(self, query_hash: str, max_age_s: int = 300) -> Optional[dict]:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT response, created_at FROM search_cache WHERE query_hash = ?",
                (query_hash,),
            ).fetchone()
            if row and (time.time() - row["created_at"]) < max_age_s:
                return json.loads(row["response"])
        return None

    def set_cached_search(self, query_hash: str, query: str, response: dict):
        with self._conn() as conn:
            conn.execute(
                "REPLACE INTO search_cache (query_hash, query, response, created_at) VALUES (?, ?, ?, ?)",
                (query_hash, query, json.dumps(response), time.time()),
            )

    # ── Preferences ──

    def get_preferences(self, uid: str = "default") -> dict:
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM user_preferences WHERE id = ?", (uid,)).fetchone()
            if row:
                return {
                    "id": row["id"],
                    "preferred_sources": json.loads(row["preferred_sources"]),
                    "blocked_tags": json.loads(row["blocked_tags"]),
                    "preferred_tags": json.loads(row["preferred_tags"]),
                    "safe_mode": bool(row["safe_mode"]),
                    "default_sort": row["default_sort"],
                    "default_per_page": row["default_per_page"],
                    "updated_at": row["updated_at"],
                }
        return {"id": uid, "preferred_sources": [], "blocked_tags": [], "preferred_tags": [], "safe_mode": True, "default_sort": "relevance", "default_per_page": 20, "updated_at": None}

    def set_preferences(self, uid: str, prefs: dict):
        with self._conn() as conn:
            conn.execute(
                """REPLACE INTO user_preferences
                   (id, preferred_sources, blocked_tags, preferred_tags, safe_mode, default_sort, default_per_page, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    uid,
                    json.dumps(prefs.get("preferred_sources", [])),
                    json.dumps(prefs.get("blocked_tags", [])),
                    json.dumps(prefs.get("preferred_tags", [])),
                    int(prefs.get("safe_mode", True)),
                    prefs.get("default_sort", "relevance"),
                    prefs.get("default_per_page", 20),
                    time.time(),
                ),
            )

    # ── History ──

    def add_history(self, query: str, results_ct: int):
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO search_history (query, results_ct, created_at) VALUES (?, ?, ?)",
                (query, results_ct, time.time()),
            )


_db: Optional[Database] = None


def get_db() -> Database:
    global _db
    if _db is None:
        _db = Database()
    return _db
