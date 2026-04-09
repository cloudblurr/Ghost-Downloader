"""POST /api/analyze — single-URL metadata analysis."""

from __future__ import annotations

import json
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException
from langchain_groq import ChatGroq
from langchain_core.messages import SystemMessage, HumanMessage

import httpx
from bs4 import BeautifulSoup

from app.config import get_settings
from app.agents.safety import get_safety_filter
from app.models.schemas import AnalyzeRequest, AnalyzeResponse, MediaType, SafetyLevel
from app.utils.logger import log

router = APIRouter(prefix="/api", tags=["analyze"])

ANALYZE_PROMPT = """\
You are Ghost Search's metadata analyzer. Given a page's title, meta tags, and partial HTML,
extract structured metadata. Respond with ONLY valid JSON:

{
  "title": "cleaned title",
  "description": "brief description",
  "performers": ["name1"],
  "tags": ["tag1", "tag2"],
  "media_type": "video" | "image" | "gallery",
  "confidence": 0.0-1.0
}

Be concise. Only include data you can actually extract. confidence = how sure you are the extraction is correct.
"""


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze_url(req: AnalyzeRequest):
    """Analyze a single URL for metadata enrichment."""
    cfg = get_settings()

    # Safety check the URL
    safety = get_safety_filter()
    level, reason = safety.check_query(req.url)
    if level == SafetyLevel.BLOCKED:
        raise HTTPException(status_code=400, detail="URL blocked by safety filter")

    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            resp = await client.get(req.url, headers={"User-Agent": cfg.USER_AGENT})
            resp.raise_for_status()
            html = resp.text[:15000]  # Limit to avoid token explosion
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch URL: {exc}")

    soup = BeautifulSoup(html, "html.parser")
    og_title = (soup.find("meta", property="og:title") or {}).get("content", "")
    og_desc = (soup.find("meta", property="og:description") or {}).get("content", "")
    og_image = (soup.find("meta", property="og:image") or {}).get("content", "")
    og_video = (soup.find("meta", property="og:video") or {}).get("content", "")
    page_title = soup.title.string if soup.title else ""

    domain = urlparse(req.url).hostname or ""

    # Try LLM analysis
    result = AnalyzeResponse(
        url=req.url,
        title=og_title or page_title,
        description=og_desc,
        thumbnail=og_image or None,
        media_type=MediaType.VIDEO if og_video else MediaType.IMAGE,
        source=domain,
        safety=SafetyLevel.SAFE,
    )

    if cfg.GROQ_API_KEY:
        try:
            llm = ChatGroq(
                api_key=cfg.GROQ_API_KEY,
                model=cfg.GROQ_MODEL,
                temperature=0.0,
                max_tokens=1024,
            )
            context = f"URL: {req.url}\nTitle: {page_title}\nOG Title: {og_title}\nOG Desc: {og_desc}\nDomain: {domain}\nHTML snippet (first 3000 chars):\n{html[:3000]}"

            resp = await llm.ainvoke([
                SystemMessage(content=ANALYZE_PROMPT),
                HumanMessage(content=context),
            ])

            raw = resp.content.strip()
            if raw.startswith("```"):
                raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
                if raw.endswith("```"):
                    raw = raw[:-3]
                raw = raw.strip()

            parsed = json.loads(raw)
            result.title = parsed.get("title", result.title)
            result.description = parsed.get("description", result.description)
            result.performers = parsed.get("performers", [])
            result.tags = parsed.get("tags", [])
            result.confidence = parsed.get("confidence", 0.5)

            if parsed.get("media_type"):
                try:
                    result.media_type = MediaType(parsed["media_type"])
                except ValueError:
                    pass

        except Exception as exc:
            log.warning("LLM analysis failed: %s", exc)

    # Safety check result
    safety_level = safety.check_result(result.title or "", result.tags)
    result.safety = safety_level

    return result
