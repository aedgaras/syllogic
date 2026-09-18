"""The calling user is injected from the bearer token, not passed by clients.

These exercise the wiring itself -- that `user_id` is absent from every tool
schema, that the resolved value still reaches the tools modules, and that a
client which tries to pass one is refused -- so no database is needed.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastmcp import Client

from app import db_helpers
from app.mcp.server import mcp


def _token_for(user_id: str):
    return SimpleNamespace(claims={"user_id": user_id}, client_id=user_id)


@pytest.fixture
def as_user():
    """Authenticate in-memory calls as a given user."""

    def _as_user(user_id: str = "user_123"):
        return patch.object(db_helpers, "get_access_token", lambda: _token_for(user_id))

    return _as_user


@pytest.mark.asyncio
async def test_no_tool_advertises_a_user_id_parameter():
    offenders = [
        tool.name
        for tool in await mcp._list_tools()
        if "user_id" in tool.parameters.get("properties", {})
    ]
    assert offenders == []


@pytest.mark.asyncio
async def test_resolved_user_reaches_the_tools_module(as_user):
    with (
        as_user("user_abc"),
        patch("app.mcp.server.accounts.list_accounts", return_value=[]) as impl,
    ):
        async with Client(mcp) as client:
            await client.call_tool("list_accounts", {})

    impl.assert_called_once()
    assert impl.call_args.args[0] == "user_abc"


@pytest.mark.asyncio
async def test_other_arguments_still_pass_through(as_user):
    with (
        as_user("user_abc"),
        patch("app.mcp.server.accounts.list_accounts", return_value=[]) as impl,
    ):
        async with Client(mcp) as client:
            await client.call_tool(
                "list_accounts", {"include_inactive": True, "asset_class": "cash"}
            )

    args = impl.call_args.args
    assert args[0] == "user_abc"
    assert args[1] is True
    assert args[2] == "cash"


@pytest.mark.asyncio
async def test_client_supplied_user_id_is_refused(as_user):
    """A client can no longer smuggle in an identity -- the parameter is gone
    from the schema, so passing one is an unknown-argument error rather than
    something the tool has to validate."""
    with (
        as_user("user_abc"),
        patch("app.mcp.server.accounts.list_accounts", return_value=[]) as impl,
    ):
        async with Client(mcp) as client:
            result = await client.call_tool(
                "list_accounts", {"user_id": "someone_else"}, raise_on_error=False
            )

    assert result.is_error
    impl.assert_not_called()


@pytest.mark.asyncio
async def test_unauthenticated_call_is_rejected():
    with (
        patch.object(db_helpers, "get_access_token", lambda: None),
        patch("app.mcp.server.accounts.list_accounts", return_value=[]) as impl,
    ):
        async with Client(mcp) as client:
            result = await client.call_tool("list_accounts", {}, raise_on_error=False)

    assert result.is_error
    impl.assert_not_called()
