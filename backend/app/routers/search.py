"""POST /api/ghost-search — main search endpoint."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.agents.orchestrator import get_orchestrator
from app.models.schemas import SearchRequest, SearchResponse
from app.scrapers.registry import get_registry

router = APIRouter(prefix="/api", tags=["search"])


@router.post("/ghost-search", response_model=SearchResponse)
async def ghost_search(req: SearchRequest):
    """
    Natural-language search across all registered scrapers.
    Uses LLM for query parsing and result scoring.
    """
    try:
        orchestrator = get_orchestrator()
        return await orchestrator.search(req)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/sources")
async def list_sources():
    """List all available search sources with their capabilities."""
    registry = get_registry()
    return {"sources": [s.model_dump() for s in registry.info()]}
