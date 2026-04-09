"""GET/PUT /api/preferences — user preference management."""

from __future__ import annotations

from fastapi import APIRouter

from app.models.database import get_db
from app.models.schemas import UserPreferences

router = APIRouter(prefix="/api", tags=["preferences"])


@router.get("/preferences", response_model=UserPreferences)
async def get_preferences(uid: str = "default"):
    """Get user preferences."""
    db = get_db()
    data = db.get_preferences(uid)
    return UserPreferences(**data)


@router.put("/preferences", response_model=UserPreferences)
async def set_preferences(prefs: UserPreferences):
    """Update user preferences."""
    db = get_db()
    db.set_preferences(prefs.id, prefs.model_dump())
    data = db.get_preferences(prefs.id)
    return UserPreferences(**data)
