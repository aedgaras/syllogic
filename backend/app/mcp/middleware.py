"""FastMCP middleware: per-call logging and per-user throttling.

The MCP server had no observability of its own -- a tool call that was slow,
that failed, or that came from a key you did not expect left no trace. It also
inherited only the per-IP limiter mounted on the HTTP app, which is the wrong
granularity once several people reach the server through one egress address.

Both middlewares resolve the caller from the bearer token the same way the
tools do, so they agree with `get_mcp_user_id()` about who is calling.
"""

from __future__ import annotations

import logging
import os
import time

import anyio.to_thread
from fastmcp.exceptions import ToolError
from fastmcp.server.middleware import Middleware

from app.rate_limit import is_rate_limited

try:
    from mcp.server.auth.middleware.auth_context import get_access_token
except ImportError:  # pragma: no cover - fallback when MCP auth isn't available

    def get_access_token():  # type: ignore[misc]
        return None


logger = logging.getLogger(__name__)

_UNKNOWN_CALLER = "anonymous"


def _bounded_env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        value = default
    return max(minimum, min(maximum, value))


def caller_id() -> str:
    """The authenticated user behind this call, or a placeholder.

    Requests reaching a tool are already authenticated by the HTTP layer, so
    the placeholder should only appear in stdio mode or in tests.
    """
    token = get_access_token()
    if token is None:
        return _UNKNOWN_CALLER
    claims = getattr(token, "claims", None) or {}
    return claims.get("user_id") or getattr(token, "client_id", _UNKNOWN_CALLER)


class ToolCallLogger(Middleware):
    """Log one line per tool call: who, what, how long, and whether it worked.

    Arguments are deliberately never logged. They carry merchant names,
    amounts and account identifiers -- the whole point of the data this server
    guards.
    """

    async def on_call_tool(self, context, call_next):
        tool = getattr(context.message, "name", "<unknown>")
        user = caller_id()
        started = time.perf_counter()
        try:
            result = await call_next(context)
        except Exception as exc:
            elapsed_ms = (time.perf_counter() - started) * 1000
            # The exception type alone, not str(exc): a message may quote the
            # arguments or a database row.
            logger.warning(
                "mcp tool=%s user=%s outcome=error duration_ms=%.1f error=%s",
                tool,
                user,
                elapsed_ms,
                type(exc).__name__,
            )
            raise
        elapsed_ms = (time.perf_counter() - started) * 1000
        logger.info(
            "mcp tool=%s user=%s outcome=ok duration_ms=%.1f",
            tool,
            user,
            elapsed_ms,
        )
        return result


class PerUserRateLimit(Middleware):
    """Throttle tool calls per authenticated user.

    This sits alongside, not instead of, the per-IP limiter on the HTTP app.
    The IP limiter is what stops unauthenticated key guessing; it just can't
    tell two people behind one address apart, and whichever limit is lower
    binds first.
    """

    def __init__(self, max_requests: int | None = None, window_seconds: int | None = None):
        self.max_requests = (
            max_requests
            if max_requests is not None
            else _bounded_env_int("MCP_USER_RATE_LIMIT", 240, 0, 100_000)
        )
        self.window_seconds = (
            window_seconds
            if window_seconds is not None
            else _bounded_env_int("MCP_USER_RATE_LIMIT_WINDOW", 60, 1, 3600)
        )

    async def on_call_tool(self, context, call_next):
        if self.max_requests <= 0:  # explicitly disabled
            return await call_next(context)

        user = caller_id()
        # is_rate_limited does a small synchronous UPSERT; keep it off the
        # event loop so one slow database round-trip can't stall other calls.
        limited = await anyio.to_thread.run_sync(
            is_rate_limited, f"mcp-user:{user}", self.max_requests, self.window_seconds
        )
        if limited:
            logger.warning(
                "mcp tool=%s user=%s outcome=rate_limited",
                getattr(context.message, "name", "<unknown>"),
                user,
            )
            raise ToolError(
                "Rate limit exceeded. Too many tool calls in a short period; "
                "wait a moment and try again."
            )
        return await call_next(context)
