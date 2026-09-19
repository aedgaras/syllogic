"""Error reporting for MCP tools.

Two rules live here.

**Nothing from the database goes back to the caller.** That is the same rule
`ToolCallLogger` follows in the other direction: it refuses to log tool
*arguments* because they carry merchant names, amounts and account
identifiers. This module refuses to return database *exception text* for the
same reason -- a SQLAlchemy error string quotes the failing statement, the
table and column names, the constraint that rejected the write, and often a
row value. That text used to be interpolated straight into the tool response,
which for a hosted client means handing the schema to a third-party API. The
correlation id is what makes the terser replacement supportable: the full
traceback is in the server log, keyed by an id the user can quote.

**Failures raise `ToolError`; they are not returned.** This server used to
have three conventions at once -- `{"error": ...}`, `{"success": False,
"error": ...}`, and `raise ToolError` -- so a client had to check all three to
know whether anything happened. MCP already sets `isError` on a tool result
when the handler raises, and `ToolError`'s message is the one thing FastMCP
passes through to the caller unmasked. A payload flag on top of that is a
second source of truth that clients check inconsistently, and the failure mode
is the bad one: a caller that forgets the check reads an error body as data.

The constructors below return a populated `ToolError` rather than raising it,
so a call site reads `raise not_found(...)` and stays a single expression.
Each one carries the way out in the message: the allowed values, the
candidate ids, or the expected format. An agent that gets told "Invalid
period" retries with another guess; one that gets told the three permitted
values fixes the call.
"""

from __future__ import annotations

import logging
from uuid import uuid4

from fastmcp.exceptions import ToolError


logger = logging.getLogger(__name__)


UUID_EXAMPLE = "3f2b1c8e-0a4d-4e6f-9b12-7c5d8e1a2b3c"

# How many candidates a not_found message names before it stops and points at
# the listing tool. Twenty is a few hundred tokens -- enough for the agent to
# spot the one it meant, short of drowning the actual error.
MAX_CANDIDATES = 20


def _raise_safe(tool: str, exc: BaseException, outcome: str, cause: str) -> None:
    ref = uuid4().hex[:12]
    # exc_info=exc, not logger.exception(): the latter reads whatever is in
    # sys.exc_info(), so the detail silently vanishes if this is ever called
    # outside an `except` block. The exception is passed in; use it.
    logger.error("mcp tool=%s ref=%s outcome=%s", tool, ref, outcome, exc_info=exc)
    raise ToolError(
        f"The operation could not be completed due to {cause}. Reference: {ref}"
    ) from None


def raise_database_error(tool: str, exc: BaseException) -> None:
    """Log a database failure in full and raise a safe ToolError."""
    _raise_safe(tool, exc, "db_error", "a database error")


def raise_dispatch_error(tool: str, exc: BaseException) -> None:
    """Log a broker/queue failure in full and raise a safe ToolError.

    Same reasoning as `raise_database_error`, different infrastructure: a
    Celery or Redis connection error renders as its URL, and that URL carries
    the broker password.
    """
    _raise_safe(tool, exc, "dispatch_error", "a delivery error")


def not_found(
    kind: str,
    identifier: object,
    *,
    candidates: list[tuple[str, object]] | None = None,
    tool: str | None = None,
) -> ToolError:
    """The row does not exist -- here is what does.

    `candidates` is (name, id) pairs the caller already has in hand. Fetch
    them from the session the lookup used; opening a second one to build an
    error message is how a failed read turns into two failed reads.
    """
    parts = [f"No {kind} found with id {_show(identifier)}."]

    if candidates:
        shown = candidates[:MAX_CANDIDATES]
        listed = ", ".join(f"{name} (id: {cid})" for name, cid in shown)
        parts.append(f"Available: {listed}")
        remaining = len(candidates) - len(shown)
        if remaining > 0:
            tail = f"... {remaining} more"
            if tool:
                tail += f" -- call {tool}() for the full set"
            parts.append(tail + ".")
    elif tool:
        parts.append(f"Call {tool}() for valid ids.")

    return ToolError(" ".join(parts))


def invalid_enum(param: str, value: object, allowed: tuple[str, ...] | list[str]) -> ToolError:
    """A closed set of values, inlined.

    These sets are short and fixed (match_mode, sort_by, category_type,
    asset_class), so naming them all costs a handful of tokens and saves a
    round trip.
    """
    return ToolError(f"Invalid {param}: {_show(value)}. Expected one of: {', '.join(allowed)}.")


def invalid_format(
    param: str,
    value: object,
    expected: str,
    *,
    example: str | None = None,
    hint: str | None = None,
) -> ToolError:
    """Malformed input. The value is echoed so the agent can see its own typo."""
    message = f"Invalid {param}: {_show(value)}. Expected {expected}"
    if example:
        message += f", e.g. {example!r}"
    message += "."
    if hint:
        message += f" {hint}"
    return ToolError(message)


def invalid_uuid(param: str, value: object, *, tool: str | None = None) -> ToolError:
    """The commonest invalid_format, spelled once."""
    hint = f"Call {tool}() for valid ids." if tool else None
    return invalid_format(param, value, "a UUID", example=UUID_EXAMPLE, hint=hint)


def out_of_range(
    param: str,
    value: object,
    *,
    minimum: object | None = None,
    maximum: object | None = None,
) -> ToolError:
    """A numeric bound violation, stating the bound that was crossed."""
    if minimum is not None and maximum is not None:
        bound = f"between {minimum} and {maximum}"
    elif minimum is not None:
        bound = f"at least {minimum}"
    elif maximum is not None:
        bound = f"at most {maximum}"
    else:  # pragma: no cover - a range with no bound is a programming error
        bound = "within range"
    return ToolError(f"Invalid {param}: {_show(value)}. Expected {bound}.")


def missing_argument(param: str, requirement: str) -> ToolError:
    """A required argument was omitted or empty."""
    return ToolError(f"Missing {param}: {requirement}.")


def _show(value: object) -> str:
    """Render a value for an error message without letting it run away.

    Truncated because these messages quote caller input, and a caller that
    pasted a 40KB blob into a uuid field should get an error, not its blob
    back.
    """
    text = repr(value)
    return text if len(text) <= 120 else text[:117] + "..."
