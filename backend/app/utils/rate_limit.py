"""Simple in-memory rate limiter stub. Swap for Redis-based in production."""

from __future__ import annotations

import time
from collections import defaultdict

from fastapi import Request, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware

from app.config import get_settings


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Sliding-window rate limiter per client IP."""

    def __init__(self, app):
        super().__init__(app)
        cfg = get_settings()
        self.rpm = cfg.RATE_LIMIT_RPM
        self._hits: dict[str, list[float]] = defaultdict(list)

    async def dispatch(self, request: Request, call_next):
        if self.rpm <= 0:
            return await call_next(request)

        client = request.client.host if request.client else "unknown"
        now = time.time()
        window = now - 60

        # Prune old entries
        self._hits[client] = [t for t in self._hits[client] if t > window]

        if len(self._hits[client]) >= self.rpm:
            raise HTTPException(status_code=429, detail="Rate limit exceeded. Try again in a minute.")

        self._hits[client].append(now)
        return await call_next(request)
