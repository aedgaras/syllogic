"""Tests for the MCP tool-call logging and per-user throttling middleware."""

from __future__ import annotations

import logging
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastmcp.exceptions import ToolError

from app.mcp import middleware as mw


def _context(tool_name: str = "list_accounts"):
    return SimpleNamespace(message=SimpleNamespace(name=tool_name))


def _resource_context(uri: str = "syllogic://accounts"):
    return SimpleNamespace(message=SimpleNamespace(uri=uri))


async def _ok(_context):
    return "result"


async def _boom(_context):
    raise RuntimeError("the database is on fire and the row said 'secret'")


@pytest.fixture
def as_user():
    def _as_user(user_id: str | None = "user_123"):
        token = (
            None
            if user_id is None
            else SimpleNamespace(claims={"user_id": user_id}, client_id=user_id)
        )
        return patch.object(mw, "get_access_token", lambda: token)

    return _as_user


class TestCallerId:
    def test_reads_the_user_from_the_token_claims(self, as_user):
        with as_user("user_abc"):
            assert mw.caller_id() == "user_abc"

    def test_falls_back_to_client_id(self):
        token = SimpleNamespace(claims={}, client_id="client_xyz")
        with patch.object(mw, "get_access_token", lambda: token):
            assert mw.caller_id() == "client_xyz"

    def test_without_a_token_reports_anonymous(self, as_user):
        with as_user(None):
            assert mw.caller_id() == "anonymous"


class TestToolCallLogger:
    @pytest.mark.asyncio
    async def test_logs_a_successful_call(self, as_user, caplog):
        with as_user("user_abc"), caplog.at_level(logging.INFO, logger=mw.__name__):
            result = await mw.ToolCallLogger().on_call_tool(_context(), _ok)

        assert result == "result"
        assert len(caplog.records) == 1
        message = caplog.records[0].getMessage()
        assert "tool=list_accounts" in message
        assert "user=user_abc" in message
        assert "outcome=ok" in message
        assert "duration_ms=" in message

    @pytest.mark.asyncio
    async def test_reraises_and_logs_failures(self, as_user, caplog):
        with as_user("user_abc"), caplog.at_level(logging.WARNING, logger=mw.__name__):
            with pytest.raises(RuntimeError):
                await mw.ToolCallLogger().on_call_tool(_context(), _boom)

        message = caplog.records[0].getMessage()
        assert "outcome=error" in message
        assert "error=RuntimeError" in message

    @pytest.mark.asyncio
    async def test_failure_log_does_not_leak_the_exception_message(self, as_user, caplog):
        """Exception text can quote arguments or database rows, so only the
        type is recorded."""
        with as_user("user_abc"), caplog.at_level(logging.WARNING, logger=mw.__name__):
            with pytest.raises(RuntimeError):
                await mw.ToolCallLogger().on_call_tool(_context(), _boom)

        assert "secret" not in caplog.text
        assert "on fire" not in caplog.text

    @pytest.mark.asyncio
    async def test_arguments_are_never_logged(self, as_user, caplog):
        context = SimpleNamespace(
            message=SimpleNamespace(
                name="search_transactions",
                arguments={"query": "Dr. Oncology Clinic"},
            )
        )
        with as_user("user_abc"), caplog.at_level(logging.INFO, logger=mw.__name__):
            await mw.ToolCallLogger().on_call_tool(context, _ok)

        assert "Oncology" not in caplog.text


class TestPerUserRateLimit:
    @pytest.mark.asyncio
    async def test_allows_calls_under_the_limit(self, as_user):
        limiter = mw.PerUserRateLimit(max_requests=10, window_seconds=60)
        with as_user(), patch.object(mw, "is_rate_limited", return_value=False):
            assert await limiter.on_call_tool(_context(), _ok) == "result"

    @pytest.mark.asyncio
    async def test_raises_a_tool_error_over_the_limit(self, as_user):
        limiter = mw.PerUserRateLimit(max_requests=10, window_seconds=60)
        with as_user(), patch.object(mw, "is_rate_limited", return_value=True):
            with pytest.raises(ToolError, match="Rate limit exceeded"):
                await limiter.on_call_tool(_context(), _ok)

    @pytest.mark.asyncio
    async def test_buckets_are_scoped_per_user(self, as_user):
        limiter = mw.PerUserRateLimit(max_requests=10, window_seconds=60)
        seen = []

        def record(key, *args):
            seen.append(key)
            return False

        with as_user("user_abc"), patch.object(mw, "is_rate_limited", record):
            await limiter.on_call_tool(_context(), _ok)
        with as_user("user_def"), patch.object(mw, "is_rate_limited", record):
            await limiter.on_call_tool(_context(), _ok)

        assert seen == ["mcp-user:user_abc", "mcp-user:user_def"]

    @pytest.mark.asyncio
    async def test_zero_disables_the_limiter_entirely(self, as_user):
        limiter = mw.PerUserRateLimit(max_requests=0, window_seconds=60)
        with as_user(), patch.object(mw, "is_rate_limited", return_value=True) as check:
            assert await limiter.on_call_tool(_context(), _ok) == "result"
        check.assert_not_called()

    def test_limits_come_from_the_environment(self):
        with patch.dict(
            "os.environ",
            {"MCP_USER_RATE_LIMIT": "5", "MCP_USER_RATE_LIMIT_WINDOW": "30"},
        ):
            limiter = mw.PerUserRateLimit()
        assert limiter.max_requests == 5
        assert limiter.window_seconds == 30

    def test_an_unparseable_limit_falls_back_to_the_default(self):
        with patch.dict("os.environ", {"MCP_USER_RATE_LIMIT": "not-a-number"}):
            limiter = mw.PerUserRateLimit()
        assert limiter.max_requests == 240


class TestResourcesAreNotASideDoor:
    """Both middlewares originally hooked `on_call_tool` only.

    A resource reads the same tables a tool does, so one left off these hooks
    is an unthrottled, untraced way to read a user's accounts -- and the
    cheaper of the two paths, which is the one an agent under a limit would
    find.
    """

    @pytest.mark.asyncio
    async def test_resource_reads_count_against_the_same_budget(self, as_user):
        limiter = mw.PerUserRateLimit(max_requests=10, window_seconds=60)
        seen = []

        def record(key, *args):
            seen.append(key)
            return False

        with as_user("user_abc"), patch.object(mw, "is_rate_limited", record):
            await limiter.on_call_tool(_context(), _ok)
            await limiter.on_read_resource(_resource_context(), _ok)

        # One bucket, not two -- a separate resource allowance would just be
        # the way around the tool one.
        assert seen == ["mcp-user:user_abc", "mcp-user:user_abc"]

    @pytest.mark.asyncio
    async def test_resource_reads_are_refused_over_the_limit(self, as_user):
        limiter = mw.PerUserRateLimit(max_requests=10, window_seconds=60)
        with as_user(), patch.object(mw, "is_rate_limited", return_value=True):
            with pytest.raises(ToolError, match="Rate limit exceeded"):
                await limiter.on_read_resource(_resource_context(), _ok)

    @pytest.mark.asyncio
    async def test_resource_reads_are_logged(self, as_user, caplog):
        with caplog.at_level(logging.INFO, logger="app.mcp.middleware"), as_user("user_abc"):
            await mw.ToolCallLogger().on_read_resource(_resource_context(), _ok)

        assert "resource=syllogic://accounts" in caplog.text
        assert "user=user_abc" in caplog.text
        assert "outcome=ok" in caplog.text

    @pytest.mark.asyncio
    async def test_a_failed_resource_read_logs_the_type_not_the_message(self, as_user, caplog):
        """Same rule as tools: a message may quote a database row."""
        with caplog.at_level(logging.WARNING, logger="app.mcp.middleware"), as_user():
            with pytest.raises(RuntimeError):
                await mw.ToolCallLogger().on_read_resource(_resource_context(), _boom)

        assert "error=RuntimeError" in caplog.text
        assert "secret" not in caplog.text

    @pytest.mark.asyncio
    async def test_prompt_reads_are_logged(self, as_user, caplog):
        with caplog.at_level(logging.INFO, logger="app.mcp.middleware"), as_user():
            await mw.ToolCallLogger().on_get_prompt(_context("month_end_close"), _ok)

        assert "prompt=month_end_close" in caplog.text
