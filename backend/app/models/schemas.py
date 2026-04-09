"""Pydantic schemas for all API request/response models."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


# ── Enums ──


class MediaType(str, Enum):
    VIDEO = "video"
    IMAGE = "image"
    GALLERY = "gallery"
    GIF = "gif"


class SafetyLevel(str, Enum):
    SAFE = "safe"
    QUESTIONABLE = "questionable"
    BLOCKED = "blocked"


class SortBy(str, Enum):
    RELEVANCE = "relevance"
    DATE = "date"
    RATING = "rating"
    VIEWS = "views"


# ── Search ──


class SearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=500, description="Natural-language search query")
    page: int = Field(1, ge=1, le=100)
    per_page: int = Field(20, ge=1, le=50)
    sources: Optional[list[str]] = Field(None, description="Limit search to these scraper IDs, or null for all")
    media_type: Optional[MediaType] = None
    sort_by: SortBy = SortBy.RELEVANCE
    safe_mode: bool = Field(True, description="Apply safety filtering")


class ParsedQuery(BaseModel):
    """Structured representation of a natural language query after LLM parsing."""
    original: str
    keywords: list[str] = []
    performers: list[str] = []
    tags: list[str] = []
    site_hints: list[str] = []
    media_type: Optional[MediaType] = None
    intent: str = "search"  # search | lookup_performer | lookup_scene


class SearchResult(BaseModel):
    id: str
    source: str
    title: str
    url: str
    thumbnail: Optional[str] = None
    preview_url: Optional[str] = None
    media_type: MediaType = MediaType.VIDEO
    duration: Optional[int] = None  # seconds
    views: Optional[int] = None
    rating: Optional[float] = None
    tags: list[str] = []
    performers: list[str] = []
    date: Optional[str] = None
    relevance_score: float = Field(0.0, ge=0.0, le=1.0)
    quality_score: float = Field(0.0, ge=0.0, le=1.0)
    safety: SafetyLevel = SafetyLevel.SAFE


class SearchResponse(BaseModel):
    query: str
    parsed: ParsedQuery
    results: list[SearchResult] = []
    total: int = 0
    page: int = 1
    per_page: int = 20
    sources_searched: list[str] = []
    search_time_ms: int = 0


# ── Analyze ──


class AnalyzeRequest(BaseModel):
    url: str = Field(..., description="URL to analyze for metadata")


class AnalyzeResponse(BaseModel):
    url: str
    title: Optional[str] = None
    description: Optional[str] = None
    performers: list[str] = []
    tags: list[str] = []
    duration: Optional[int] = None
    thumbnail: Optional[str] = None
    media_type: MediaType = MediaType.VIDEO
    source: Optional[str] = None
    stash_match: Optional[dict] = None
    safety: SafetyLevel = SafetyLevel.SAFE
    confidence: float = 0.0


# ── Preferences ──


class UserPreferences(BaseModel):
    id: str = "default"
    preferred_sources: list[str] = []
    blocked_tags: list[str] = []
    preferred_tags: list[str] = []
    safe_mode: bool = True
    default_sort: SortBy = SortBy.RELEVANCE
    default_per_page: int = 20
    updated_at: Optional[datetime] = None


# ── Available Sources ──


class SourceInfo(BaseModel):
    id: str
    name: str
    description: str
    media_types: list[MediaType]
    enabled: bool = True


class SourcesResponse(BaseModel):
    sources: list[SourceInfo] = []
