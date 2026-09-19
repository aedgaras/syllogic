"""FastMCP middleware: toolset selection, per-call logging, per-user throttling.

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
from fastmcp.server.dependencies import get_http_headers, get_http_request
from fastmcp.server.middleware import Middleware

from app.mcp import toolsets
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
    """Log one line per tool call or resource read: who, what, how long, ok?

    Arguments are deliberately never logged. They carry merchant names,
    amounts and account identifiers -- the whole point of the data this server
    guards.

    Resource reads are logged on the same line shape as tool calls, because
    they reach the same data. A resource left off this hook is a way to read
    a user's accounts that leaves no trace.
    """

    async def _observe(self, context, call_next, kind: str, name: str):
        user = caller_id()
        started = time.perf_counter()
        try:
            result = await call_next(context)
        except Exception as exc:
            elapsed_ms = (time.perf_counter() - started) * 1000
            # The exception type alone, not str(exc): a message may quote the
            # arguments or a database row.
            logger.warning(
                "mcp %s=%s user=%s outcome=error duration_ms=%.1f error=%s",
                kind,
                name,
                user,
                elapsed_ms,
                type(exc).__name__,
            )
            raise
        elapsed_ms = (time.perf_counter() - started) * 1000
        logger.info(
            "mcp %s=%s user=%s outcome=ok duration_ms=%.1f",
            kind,
            name,
            user,
            elapsed_ms,
        )
        return result

    async def on_call_tool(self, context, call_next):
        return await self._observe(
            context, call_next, "tool", getattr(context.message, "name", "<unknown>")
        )

    async def on_read_resource(self, context, call_next):
        return await self._observe(
            context, call_next, "resource", str(getattr(context.message, "uri", "<unknown>"))
        )

    async def on_get_prompt(self, context, call_next):
        return await self._observe(
            context, call_next, "prompt", getattr(context.message, "name", "<unknown>")
        )


class PerUserRateLimit(Middleware):
    """Throttle tool calls per authenticated user.

    This sits alongside, not instead of, the per-IP limiter on the HTTP app.
    The IP limiter is what stops unauthenticated key guessing; it just can't
    tell two people behind one address apart, and whichever limit is lower
    binds first.

    Resource reads count against the same budget. They hit the same tables,
    so a limiter that covered only tools would leave the cheaper path to the
    same data wide open.
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

    async def _throttle(self, context, call_next, kind: str, name: str):
        if self.max_requests <= 0:  # explicitly disabled
            return await call_next(context)

        user = caller_id()
        # is_rate_limited does a small synchronous UPSERT; keep it off the
        # event loop so one slow database round-trip can't stall other calls.
        # One counter across tools and resources: they cost the same database
        # work, and a separate resource budget would just be the way around
        # this one.
        limited = await anyio.to_thread.run_sync(
            is_rate_limited, f"mcp-user:{user}", self.max_requests, self.window_seconds
        )
        if limited:
            logger.warning("mcp %s=%s user=%s outcome=rate_limited", kind, name, user)
            raise ToolError(
                "Rate limit exceeded. Too many tool calls in a short period; "
                "wait a moment and try again."
            )
        return await call_next(context)

    async def on_call_tool(self, context, call_next):
        return await self._throttle(
            context, call_next, "tool", getattr(context.message, "name", "<unknown>")
        )

    async def on_read_resource(self, context, call_next):
        return await self._throttle(
            context, call_next, "resource", str(getattr(context.message, "uri", "<unknown>"))
        )


class ToolsetSelection(Middleware):
    """Apply the connect-time toolset selection, once per session.

    A session starts with `core` visible and the other five toolsets hidden
    (see the server transform in app/mcp/server.py). `load_toolset` is the
    cheap way back to them, but it only works on a client that acts on
    `notifications/tools/list_changed`. A client that ignores the
    notification would be stuck with whatever it listed on connect.

    So the selection can also be made in the connection itself, as
    `?toolsets=budgets,recurring` on the MCP URL or an `X-Syllogic-Toolsets`
    header, and `toolsets=all` restores the whole surface. This runs it on the
    first request of a session that carries one, before anything is listed.

    Stdio and tests have no HTTP request; there is nothing to read there, so
    the default surface stands.
    """

    _STATE_KEY = "_toolset_selection_applied"

    def __init__(self) -> None:
        # tool name -> its optional toolset, built once. The registry is fixed
        # at import, and _autoload_for_call runs on every tool call, so
        # enumerating the server's tools each time would be a full walk per
        # call to answer a question whose answer never changes.
        self._toolset_of: dict[str, set[str]] | None = None

    async def _toolset_index(self, server) -> dict[str, set[str]]:
        if self._toolset_of is None:
            self._toolset_of = {
                tool.name: set(tool.tags) & toolsets.OPTIONAL for tool in await server._list_tools()
            }
        return self._toolset_of

    async def _apply(self, context) -> None:
        ctx = context.fastmcp_context
        if ctx is None:
            return

        raw = self._requested_raw()
        if raw is None:
            return

        try:
            # Session state, not an instance attribute: one middleware object
            # serves every session on the process.
            if await ctx.get_state(self._STATE_KEY):
                return
        except Exception:  # pragma: no cover - no session (stdio, tests)
            return

        try:
            requested = toolsets.parse(raw)
        except toolsets.UnknownToolset as exc:
            # Refusing the connection over a typo would lock the user out of
            # the server entirely. Log it and serve the default surface; the
            # agent can still reach the rest through load_toolset.
            logger.warning("mcp toolset_selection invalid=%r error=%s", raw, exc)
            await ctx.set_state(self._STATE_KEY, True)
            return

        await ctx.set_state(self._STATE_KEY, True)
        loaded = await toolsets.enable(ctx, requested)
        if loaded:
            logger.info(
                "mcp toolset_selection user=%s loaded=%s",
                caller_id(),
                ",".join(sorted(loaded)),
            )

    async def _autoload_for_call(self, context) -> None:
        """Load the toolset behind a tool the client called but cannot see.

        FastMCP refuses a call to a hidden tool with "unknown tool", and a
        client resuming a conversation from its own history has every reason
        to call one: the name is right there in the transcript, from before
        the session was restarted. Answering "no such tool" would make the
        listing a trap rather than a default.

        So a call to a hidden tool loads its toolset and then runs. The agent
        gets its answer, the rest of that toolset comes into the listing with
        it, and nothing has to know the session was ever narrower.
        """
        ctx = context.fastmcp_context
        if ctx is None:
            return

        name = getattr(context.message, "name", None)
        if not name:
            return

        server = getattr(ctx, "fastmcp", None)
        if server is None:  # pragma: no cover - always set on a real context
            return

        # A name that is not in the index is genuinely unknown, or core and
        # therefore already visible. Either way there is nothing to load and
        # FastMCP's own answer is the right one.
        wanted = (await self._toolset_index(server)).get(name)
        if not wanted:
            return

        loaded = await toolsets.enable(ctx, wanted)
        if loaded:
            logger.info(
                "mcp toolset_autoload user=%s tool=%s loaded=%s",
                caller_id(),
                name,
                ",".join(sorted(loaded)),
            )

    @staticmethod
    def _requested_raw() -> str | None:
        """The selection: query string, else header, else deployment default.

        The env default is last so a connection that states what it wants
        always wins over it, and it is read on every call rather than at
        import so a deployment can change it with a restart of the process
        and nothing else.
        """
        try:
            request = get_http_request()
        except RuntimeError:
            request = None

        if request is not None:
            value = request.query_params.get(toolsets.QUERY_PARAM)
            if value:
                return value

        try:
            headers = get_http_headers()
        except RuntimeError:  # pragma: no cover - no HTTP context
            headers = {}
        return headers.get(toolsets.HEADER) or os.getenv(toolsets.ENV_VAR) or None

    async def on_list_tools(self, context, call_next):
        await self._apply(context)
        return await call_next(context)

    async def on_call_tool(self, context, call_next):
        # The connect-time selection has to be in force before the call runs:
        # a client may call a tool it remembers without listing first.
        await self._apply(context)
        await self._autoload_for_call(context)
        return await call_next(context)
