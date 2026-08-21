"""Redis-backed request throttling.

Deliberately simple (fixed-window counters via INCR/EXPIRE) rather than a
sliding-window or token-bucket scheme -- this is meant to stop obvious abuse
(credential stuffing, cost-burning LLM spam, unauthenticated key-guessing),
not to be a precise limiter.

Fails open: if Redis is unreachable, requests are allowed through and a
warning is logged. Rate limiting is a defense-in-depth layer here, not a
hard dependency -- it must not become a new way to take the app down.
"""

from __future__ import annotations

import logging
import os
import time
from typing import Optional

import redis
from starlette.responses import JSONResponse

logger = logging.getLogger(__name__)

_REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
_client: Optional[redis.Redis] = None


def _get_client() -> redis.Redis:
    global _client
    if _client is None:
        _client = redis.from_url(_REDIS_URL, socket_connect_timeout=1, socket_timeout=1)
    return _client


def is_rate_limited(key: str, max_requests: int, window_seconds: int) -> bool:
    """Returns True if `key` has exceeded `max_requests` in the current
    `window_seconds`-wide fixed window."""
    try:
        client = _get_client()
        bucket = int(time.time() // window_seconds)
        redis_key = f"ratelimit:{key}:{bucket}"
        count = client.incr(redis_key)
        if count == 1:
            client.expire(redis_key, window_seconds)
        return count > max_requests
    except Exception:
        logger.warning(
            "Rate limiter backend unreachable; allowing request (fail-open).",
            exc_info=True,
        )
        return False


class IPRateLimitMiddleware:
    """Starlette ASGI middleware: throttles by client IP.

    Used on the MCP HTTP app, which (unlike the main backend) receives
    requests directly from whoever can reach it -- including unauthenticated
    bearer/API-key presentation attempts -- rather than only from the
    internal-auth-signed Next.js proxy.
    """

    def __init__(
        self,
        app,
        max_requests: int = 60,
        window_seconds: int = 60,
        exempt_paths: frozenset[str] = frozenset({"/health"}),
    ) -> None:
        self.app = app
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.exempt_paths = exempt_paths

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("path") in self.exempt_paths:
            await self.app(scope, receive, send)
            return

        client = scope.get("client")
        client_ip = client[0] if client else "unknown"

        if is_rate_limited(f"mcp-ip:{client_ip}", self.max_requests, self.window_seconds):
            response = JSONResponse(
                {"detail": "Too many requests. Please try again later."},
                status_code=429,
            )
            await response(scope, receive, send)
            return

        await self.app(scope, receive, send)
