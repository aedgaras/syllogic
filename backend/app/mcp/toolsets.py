"""Toolsets: which tools an agent sees before it has said what it wants.

The full surface is 52 tools and roughly 22,000 tokens of `tools/list` JSON.
That is paid on every session, before the user has typed anything, by an agent
that on most turns needs a dozen of them. It also crowds out whatever else the
client wanted in the window, and a client that truncates a long tool list
truncates it at a point nobody chose.

So every tool carries exactly one **toolset** tag -- `core`, `edit_transactions`,
`budgets`, `recurring`, `investments`, `reports` -- plus `read` or `write`.
Only `core` is visible when a session opens. The rest come back one of two ways,
both of which end up in the same place (FastMCP session visibility rules):

- **The client asks at connect time**, with `?toolsets=budgets,recurring` on the
  MCP URL or an `X-Syllogic-Toolsets` header. The list is then fixed for the
  whole session, which is what a client that ignores
  `notifications/tools/list_changed` needs.
- **The agent asks mid-session**, by calling `load_toolset`. Cheaper, because
  nothing is loaded until it is wanted, but it only works on a client that
  honours the list-changed notification.

`toolsets=all` restores the pre-split behaviour for anything that depended on it.
"""

from __future__ import annotations


CORE = "core"

#: Toolset name -> the one line an agent reads when deciding whether to load it.
#: These strings are the whole of `load_toolset`'s documentation, so they have
#: to answer "would this have what I need" on their own.
TOOLSETS: dict[str, str] = {
    CORE: (
        "Accounts, categories, transaction browsing and search, and the "
        "spending/income/cashflow analytics. Always loaded."
    ),
    "edit_transactions": (
        "Create, edit and delete transactions, record transfers between the "
        "user's own accounts, recategorize in bulk, and save categorization "
        "rules onto a category. Load this to change anything about a transaction."
    ),
    "budgets": (
        "Budgets: their limits, per-category breakdowns, pace against the "
        "current period, spending history, and creating or adjusting them."
    ),
    "recurring": (
        "Subscriptions and recurring bills: what recurs, what it costs per "
        "month, and generating or skipping an individual occurrence."
    ),
    "investments": (
        "Holdings, portfolio value and its history, trades for one holding, and ticker lookup."
    ),
    "reports": (
        "Scheduled email reports: what is scheduled, its delivery history, "
        "and creating, editing or test-sending one."
    ),
}

OPTIONAL: frozenset[str] = frozenset(TOOLSETS) - {CORE}

#: Accepted in place of a name list to mean "everything".
ALL = "all"

#: Header a client can send instead of putting the selection in the URL. Some
#: MCP clients let you configure headers but not a query string.
HEADER = "x-syllogic-toolsets"

#: Query parameter on the MCP URL.
QUERY_PARAM = "toolsets"

#: Deployment-wide default, for when neither of the above is reachable. A
#: client whose connection URL is not editable (a hosted connector, say) and
#: which ignores `notifications/tools/list_changed` cannot get at the optional
#: toolsets at all: `load_toolset` widens the server's surface, but the client
#: never re-lists, so the agent calls a tool its own client refuses to send.
#: Setting this to e.g. "all" or "edit_transactions" on the deployment gives
#: every session that surface from connect, and a per-connection selection
#: still overrides it.
ENV_VAR = "MCP_DEFAULT_TOOLSETS"


class UnknownToolset(ValueError):
    """A toolset name that does not exist, with the valid ones in the message."""

    def __init__(self, names: list[str]) -> None:
        self.names = names
        known = ", ".join(sorted(TOOLSETS))
        super().__init__(f"Unknown toolset(s): {', '.join(names)}. Available: {known} (or 'all').")


def parse(raw: str | None) -> set[str]:
    """Parse a comma-separated toolset selection.

    Returns the optional toolsets to enable -- `core` is dropped because it is
    always on, so asking for it is a no-op rather than an error. An empty or
    absent value selects nothing extra.

    Raises:
        UnknownToolset: if any name is not a toolset. Silently ignoring a typo
            would hand the agent a smaller surface than it asked for and no
            reason why, which is indistinguishable from the tool being missing.
    """
    if not raw:
        return set()

    requested = [part.strip().lower() for part in raw.split(",")]
    requested = [part for part in requested if part]

    if ALL in requested:
        return set(OPTIONAL)

    unknown = [name for name in requested if name not in TOOLSETS]
    if unknown:
        raise UnknownToolset(unknown)

    return {name for name in requested if name != CORE}


def describe() -> str:
    """The toolset menu, as a block for a tool docstring or an error message."""
    return "\n".join(f"- {name}: {text}" for name, text in TOOLSETS.items() if name != CORE)


# ---------------------------------------------------------------------------
# Session bookkeeping
# ---------------------------------------------------------------------------

#: Session-state key holding the toolsets already enabled for this session.
#:
#: FastMCP's own visibility rules are append-only and every one of them is
#: re-evaluated on every listing, so "have I already loaded this" has to be
#: tracked separately from "is it visible". Both `load_toolset` and the
#: autoload-on-call path read and write it, which is why it lives here rather
#: than in either of them.
LOADED_STATE_KEY = "_toolsets_loaded"


async def already_loaded(ctx) -> set[str]:
    """Toolsets this session has enabled. Empty when there is no session."""
    try:
        return set(await ctx.get_state(LOADED_STATE_KEY) or [])
    except Exception:  # pragma: no cover - stdio and tests have no session
        return set()


async def enable(ctx, names: set[str]) -> set[str]:
    """Enable `names` for this session and record it. Returns what was new.

    A no-op for toolsets already loaded: re-enabling appends a rule that then
    costs something on every subsequent listing, for no change in what is
    visible.
    """
    loaded = await already_loaded(ctx)
    new = names - loaded
    if not new:
        return set()

    await ctx.enable_components(tags=new, components={"tool"})
    await ctx.set_state(LOADED_STATE_KEY, sorted(loaded | new))
    return new
