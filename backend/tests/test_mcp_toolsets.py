"""Toolsets: what a session is shown before it has said what it wants.

The full surface is 52 tools. Listing all of them on connect spent about
22,000 tokens of the client's context on tools most sessions never call, and
left the tail of the list at the mercy of whatever the client truncates at.

So `core` is what a session opens with and the other five toolsets are hidden
until asked for -- by the agent, with `load_toolset`, or by the client, with
`?toolsets=` on the connection. Three things have to stay true for that to be
safe, and each has a test here:

- **Hidden is not gone.** A hidden tool still runs when called by name, so a
  client resuming a conversation from its own history is not broken by a
  listing decision.
- **A new tool cannot leak in untagged.** An untagged tool matches no
  visibility rule and is therefore visible always, which is the failure mode
  that quietly undoes this.
- **The budget holds.** A ceiling on the serialized listing, so the next fat
  tool fails a test rather than a user's context window.
"""

from __future__ import annotations

import json

import pytest
import pytest_asyncio
from fastmcp import Client
from fastmcp.exceptions import ToolError

from app.mcp import toolsets
from app.mcp.middleware import ToolsetSelection
from app.mcp.server import mcp


# This suite has no asyncio_mode setting, so every async test carries the
# marker -- see the class-level one in test_mcp_composite_auth.py.


# Ceilings, not targets. Generous enough that ordinary wording changes don't
# trip them, tight enough that another `search_transactions` cannot land
# unnoticed. Measured in serialized JSON bytes, which is what goes on the wire.
CORE_LISTING_CEILING = 36_000
FULL_LISTING_CEILING = 88_000


def _listing_bytes(tools) -> int:
    return sum(len(json.dumps(t.model_dump(exclude_none=True))) for t in tools)


@pytest_asyncio.fixture
async def client():
    async with Client(mcp) as c:
        yield c


# ---------------------------------------------------------------------------
# Tagging
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_every_tool_carries_one_toolset_and_one_access_tag():
    """An untagged tool matches no visibility rule, so it is visible always.

    That is not an error anywhere in FastMCP -- it just quietly opts the tool
    out of the whole scheme. This is the test that catches it.
    """
    for tool in await mcp._list_tools():
        tags = set(tool.tags)
        in_toolsets = tags & set(toolsets.TOOLSETS)
        access = tags & {"read", "write"}
        assert len(in_toolsets) == 1, f"{tool.name} has toolset tags {in_toolsets}"
        assert len(access) == 1, f"{tool.name} has access tags {access}"


@pytest.mark.asyncio
async def test_read_write_tag_agrees_with_read_only_hint():
    for tool in await mcp._list_tools():
        annotations = tool.annotations
        read_only = bool(annotations and annotations.readOnlyHint)
        expected = "read" if read_only else "write"
        assert expected in tool.tags, f"{tool.name} is tagged against its readOnlyHint"


@pytest.mark.asyncio
async def test_deprecated_tools_are_gone():
    """Phase 5 shipped the replacements and promised these for the next release.

    They were the same query with different arity or a flipped sign, so a
    caller had to read both before it could choose, and every filter added to
    one had to be added to the other or the two disagreed.
    """
    names = {tool.name for tool in await mcp._list_tools()}
    assert "search_transactions_multi" not in names  # search_transactions(queries=[...])
    assert "get_spending_by_category" not in names  # get_amounts_by_category(direction=)
    assert "get_income_by_category" not in names


# ---------------------------------------------------------------------------
# The default surface
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_session_opens_on_core_only(client):
    listed = await client.list_tools()
    names = {t.name for t in listed}

    assert "load_toolset" in names, "the way out of core has to be in core"
    assert "list_transactions" in names
    assert "get_amounts_by_category" in names

    assert "list_budgets" not in names
    assert "create_transaction" not in names
    assert "list_holdings" not in names

    core_names = {t.name for t in await mcp._list_tools() if toolsets.CORE in t.tags}
    assert names == core_names


@pytest.mark.asyncio
async def test_core_listing_stays_within_budget(client):
    size = _listing_bytes(await client.list_tools())
    assert size < CORE_LISTING_CEILING, (
        f"the connect-time listing is {size} bytes, over the {CORE_LISTING_CEILING} "
        "ceiling. Trim a description or move the tool out of core."
    )


@pytest.mark.asyncio
async def test_full_listing_stays_within_budget(client):
    await client.call_tool("load_toolset", {"names": ["all"]})
    size = _listing_bytes(await client.list_tools())
    assert size < FULL_LISTING_CEILING, (
        f"the full listing is {size} bytes, over the {FULL_LISTING_CEILING} ceiling."
    )


# ---------------------------------------------------------------------------
# load_toolset
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_load_toolset_reveals_that_toolset_and_nothing_else(client):
    result = await client.call_tool("load_toolset", {"names": ["budgets"]})
    assert result.data["loaded"] == ["budgets"]

    names = {t.name for t in await client.list_tools()}
    assert "list_budgets" in names
    assert "create_budget" in names
    assert "list_holdings" not in names, "loading budgets must not load investments"


@pytest.mark.asyncio
async def test_load_toolset_is_additive_and_sticks(client):
    await client.call_tool("load_toolset", {"names": ["budgets"]})
    result = await client.call_tool("load_toolset", {"names": ["investments"]})

    names = {t.name for t in await client.list_tools()}
    assert "list_budgets" in names, "the second load must not drop the first"
    assert "list_holdings" in names

    # `loaded` is the session's whole set, so an agent reading only the last
    # response still knows what it has.
    assert result.data["loaded"] == ["budgets", "investments"]
    assert "budgets" not in result.data["other_toolsets"]


@pytest.mark.asyncio
async def test_load_toolset_all_lists_everything(client):
    await client.call_tool("load_toolset", {"names": ["all"]})
    listed = {t.name for t in await client.list_tools()}
    everything = {t.name for t in await mcp._list_tools()}
    assert listed == everything


@pytest.mark.asyncio
async def test_load_toolset_names_what_is_left(client):
    result = await client.call_tool("load_toolset", {"names": ["budgets"]})
    remaining = result.data["other_toolsets"]
    assert "budgets" not in remaining
    assert "recurring" in remaining
    assert remaining["recurring"], "a name with no description is not a menu"


@pytest.mark.asyncio
async def test_load_toolset_reports_the_new_surface(client):
    """For a client that ignores tools/list_changed, the return value is it."""
    result = await client.call_tool("load_toolset", {"names": ["recurring"]})
    assert "get_recurring_summary" in result.data["now_available"]


@pytest.mark.asyncio
async def test_load_toolset_rejects_an_unknown_name(client):
    with pytest.raises(ToolError) as exc:
        await client.call_tool("load_toolset", {"names": ["budgtes"]})
    # The valid names go in the message: the agent cannot see them anywhere
    # else, and a bare rejection leaves it guessing.
    assert "budgets" in str(exc.value)


@pytest.mark.asyncio
async def test_load_toolset_rejects_an_empty_selection(client):
    with pytest.raises(ToolError):
        await client.call_tool("load_toolset", {"names": []})


@pytest.mark.asyncio
async def test_load_toolset_rejects_core_alone(client):
    """`core` is already loaded, so answering "loaded" would be a lie."""
    with pytest.raises(ToolError):
        await client.call_tool("load_toolset", {"names": ["core"]})


@pytest.mark.asyncio
async def test_calling_a_hidden_tool_loads_its_toolset(client):
    """Hiding is about the listing, not about what exists.

    A client resuming a conversation still has the tool name in its history,
    and FastMCP's own answer to a call on a hidden tool is "unknown tool" --
    which would make the listing a trap. The call has to reach the tool
    instead; here it gets as far as the auth dependency, which is exactly
    what an unauthenticated call would hit either way.
    """
    assert "get_recurring_summary" not in {t.name for t in await client.list_tools()}

    with pytest.raises(ToolError) as exc:
        await client.call_tool("get_recurring_summary", {})
    assert "unknown tool" not in str(exc.value).lower()

    # And the rest of that toolset comes with it, so the agent's next turn
    # does not have to rediscover it one failed call at a time.
    assert "list_recurring_transactions" in {t.name for t in await client.list_tools()}


@pytest.mark.asyncio
async def test_calling_a_genuinely_unknown_tool_still_says_so(client):
    with pytest.raises(ToolError) as exc:
        await client.call_tool("get_horoscope", {})
    assert "get_horoscope" in str(exc.value)


# ---------------------------------------------------------------------------
# Parsing the connect-time selection
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "raw,expected",
    [
        (None, set()),
        ("", set()),
        ("budgets", {"budgets"}),
        ("budgets,recurring", {"budgets", "recurring"}),
        (" Budgets , RECURRING ", {"budgets", "recurring"}),
        ("core", set()),  # already on; asking for it is a no-op, not an error
        ("core,budgets", {"budgets"}),
        ("all", set(toolsets.OPTIONAL)),
        ("budgets,all", set(toolsets.OPTIONAL)),
    ],
)
def test_parse(raw, expected):
    assert toolsets.parse(raw) == expected


def test_parse_rejects_unknown_names():
    with pytest.raises(toolsets.UnknownToolset) as exc:
        toolsets.parse("budgets,nope")
    assert "nope" in str(exc.value)
    assert "budgets" in str(exc.value)


def test_describe_lists_every_optional_toolset():
    text = toolsets.describe()
    for name in toolsets.OPTIONAL:
        assert name in text
    assert toolsets.CORE not in text.split("\n")[0].split(":")[0]


# ---------------------------------------------------------------------------
# ToolsetSelection middleware
# ---------------------------------------------------------------------------


class _StubContext:
    """Enough Context to drive the middleware without an HTTP session."""

    def __init__(self):
        self.state: dict = {}
        self.enabled: list[set[str]] = []

    async def get_state(self, key):
        return self.state.get(key)

    async def set_state(self, key, value):
        self.state[key] = value

    async def enable_components(self, *, tags, components=None):
        self.enabled.append(set(tags))


class _StubMiddlewareContext:
    def __init__(self, ctx):
        self.fastmcp_context = ctx


@pytest.fixture
def selection(monkeypatch):
    mw = ToolsetSelection()

    def set_request(raw):
        monkeypatch.setattr(ToolsetSelection, "_requested_raw", staticmethod(lambda: raw))

    return mw, set_request


@pytest.mark.asyncio
async def test_selection_applies_the_requested_toolsets(selection):
    mw, set_request = selection
    set_request("budgets,recurring")
    ctx = _StubContext()

    await mw._apply(_StubMiddlewareContext(ctx))

    assert ctx.enabled == [{"budgets", "recurring"}]


@pytest.mark.asyncio
async def test_selection_runs_once_per_session(selection):
    """It is called on every list and every tool call; it must not re-apply."""
    mw, set_request = selection
    set_request("budgets")
    ctx = _StubContext()

    await mw._apply(_StubMiddlewareContext(ctx))
    await mw._apply(_StubMiddlewareContext(ctx))
    await mw._apply(_StubMiddlewareContext(ctx))

    assert ctx.enabled == [{"budgets"}]


@pytest.mark.asyncio
async def test_selection_ignores_a_connection_that_asked_for_nothing(selection):
    mw, set_request = selection
    set_request(None)
    ctx = _StubContext()

    await mw._apply(_StubMiddlewareContext(ctx))

    assert ctx.enabled == []
    assert ctx.state == {}, "an absent selection must not consume the one-shot"


@pytest.mark.asyncio
async def test_selection_serves_the_default_surface_on_a_typo(selection):
    """A bad name must not break the connection.

    Refusing it would lock the user out of a server they can otherwise use;
    load_toolset is still there to recover with.
    """
    mw, set_request = selection
    set_request("budgtes")
    ctx = _StubContext()

    await mw._apply(_StubMiddlewareContext(ctx))

    assert ctx.enabled == []
    assert ctx.state[ToolsetSelection._STATE_KEY] is True, "and it must not retry every call"


@pytest.mark.asyncio
async def test_selection_is_a_no_op_without_a_context(selection):
    """stdio and the test suite have no session to write rules into."""
    mw, set_request = selection
    set_request("budgets")
    await mw._apply(_StubMiddlewareContext(None))  # must not raise


@pytest.mark.asyncio
async def test_enable_is_idempotent():
    """Rules accumulate and are re-evaluated on every listing.

    So a second `enable` for a toolset already loaded is not free -- it is a
    rule that costs something on every subsequent list for no change in what
    is visible.
    """
    ctx = _StubContext()

    assert await toolsets.enable(ctx, {"budgets"}) == {"budgets"}
    assert await toolsets.enable(ctx, {"budgets"}) == set()
    assert await toolsets.enable(ctx, {"budgets", "reports"}) == {"reports"}

    assert ctx.enabled == [{"budgets"}, {"reports"}]
    assert await toolsets.already_loaded(ctx) == {"budgets", "reports"}


# ---------------------------------------------------------------------------
# Where the selection comes from
# ---------------------------------------------------------------------------
#
# A hosted client whose connection URL and headers the user cannot edit, and
# which ignores tools/list_changed, can reach nothing outside `core`:
# load_toolset widens the server's surface, but the client never re-lists, so
# the call it then makes is refused by the client itself. MCP_DEFAULT_TOOLSETS
# is the deployment's way to hand those sessions a wider surface at connect.


class _StubRequest:
    def __init__(self, params: dict):
        self.query_params = params


@pytest.fixture
def selection_source(monkeypatch):
    """Drive _requested_raw with a chosen query string, headers and env."""

    def configure(*, query=None, header=None, env=None):
        def get_http_request():
            if query is None:
                raise RuntimeError("no HTTP request")
            return _StubRequest({toolsets.QUERY_PARAM: query})

        def get_http_headers():
            if header is None:
                return {}
            return {toolsets.HEADER: header}

        monkeypatch.setattr("app.mcp.middleware.get_http_request", get_http_request)
        monkeypatch.setattr("app.mcp.middleware.get_http_headers", get_http_headers)
        monkeypatch.delenv(toolsets.ENV_VAR, raising=False)
        if env is not None:
            monkeypatch.setenv(toolsets.ENV_VAR, env)

    return configure


def test_env_default_applies_when_the_connection_says_nothing(selection_source):
    selection_source(env="all")
    assert ToolsetSelection._requested_raw() == "all"


def test_env_default_survives_a_request_without_http_context(selection_source):
    """stdio has neither a request nor headers; the env default still stands."""
    selection_source(query=None, header=None, env="budgets")
    assert ToolsetSelection._requested_raw() == "budgets"


def test_query_string_beats_the_env_default(selection_source):
    selection_source(query="recurring", env="all")
    assert ToolsetSelection._requested_raw() == "recurring"


def test_header_beats_the_env_default(selection_source):
    selection_source(header="investments", env="all")
    assert ToolsetSelection._requested_raw() == "investments"


def test_no_selection_anywhere_is_none(selection_source):
    selection_source()
    assert ToolsetSelection._requested_raw() is None
