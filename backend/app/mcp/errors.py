"""Error reporting for MCP tools.

The rule here is the same one `ToolCallLogger` follows in the other
direction: the data this server guards must not end up somewhere it was not
asked to go. That middleware refuses to log tool *arguments* because they
carry merchant names, amounts and account identifiers. This module refuses to
return database *exception text* for the same reason -- a SQLAlchemy error
string quotes the failing statement, the table and column names, the
constraint that rejected the write, and often a row value.

That text used to be interpolated straight into the tool response, which for
a hosted client means handing the schema to a third-party API. The correlation
id is what makes the terser replacement supportable: the full traceback is in
the server log, keyed by an id the user can quote.
"""

from __future__ import annotations

import logging
from uuid import uuid4

from fastmcp.exceptions import ToolError


logger = logging.getLogger(__name__)


def database_error(tool: str, exc: BaseException) -> dict:
    """Log a database failure in full and return a safe response body.

    Returns the `{"success": False, "error": ...}` shape the mutation tools
    currently use, so this is a drop-in replacement. The convention itself is
    replaced by raising ToolError in a later phase.
    """
    ref = uuid4().hex[:12]
    # exc_info=exc, not logger.exception(): the latter reads whatever is in
    # sys.exc_info(), so the detail silently vanishes if this is ever called
    # outside an `except` block. The exception is passed in; use it.
    logger.error("mcp tool=%s ref=%s outcome=db_error", tool, ref, exc_info=exc)
    return {
        "success": False,
        "error": (
            f"The operation could not be completed due to a database error. Reference: {ref}"
        ),
    }


def raise_database_error(tool: str, exc: BaseException) -> None:
    """Log a database failure in full and raise a safe ToolError."""
    ref = uuid4().hex[:12]
    logger.error("mcp tool=%s ref=%s outcome=db_error", tool, ref, exc_info=exc)
    raise ToolError(
        f"The operation could not be completed due to a database error. Reference: {ref}"
    ) from None
