"""
Database session management and argument parsing for MCP tools.

Two families of parser live here, and picking the wrong one is how this
server used to return confidently wrong answers:

- `validate_uuid` / `validate_date` return None on bad input. Correct for a
  *lookup* argument, where "malformed" and "no such row" are the same answer
  to the caller.

- `require_uuid` / `require_date_bound` raise. Correct for a *filter*
  argument. The old pattern -- parse to None, then `if account_uuid:` before
  applying the filter -- meant a typo removed the filter and widened the
  result set, and the agent read the wider answer as the answer.
"""

from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timedelta
from uuid import UUID

from app.database import SessionLocal
from app.mcp.errors import invalid_format, invalid_uuid


def validate_uuid(value: str) -> UUID | None:
    """
    Safely parse UUID, returning None if invalid.

    For lookup arguments only. Use `require_uuid` for anything that filters a
    result set.

    Args:
        value: String to parse as UUID

    Returns:
        UUID object or None if invalid
    """
    try:
        return UUID(value)
    except (ValueError, TypeError):
        return None


def validate_date(value: str | None) -> datetime | None:
    """
    Safely parse ISO date, returning None if invalid.

    Prefer `require_date_bound` for range filters: it rejects bad input, and
    it gets the end-of-range semantics right.

    Args:
        value: ISO format date string (optional)

    Returns:
        datetime object or None if invalid/empty
    """
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except (ValueError, TypeError):
        return None


def require_uuid(value: str | None, param: str) -> UUID | None:
    """Parse a UUID filter argument, or refuse to run.

    Returns None only when `value` is None (the filter was not requested).
    A malformed value raises rather than silently dropping the filter.
    """
    if value is None:
        return None
    try:
        return UUID(value)
    except (ValueError, TypeError):
        raise invalid_uuid(param, value) from None


def require_uuid_list(values: list[str] | None, param: str) -> list[UUID] | None:
    """Parse a list of UUID filter arguments, or refuse to run."""
    if values is None:
        return None
    return [require_uuid(v, param) for v in values]


def require_date_bound(value: str | None, param: str, *, end: bool = False) -> datetime | None:
    """Parse a date range bound, or refuse to run.

    Both bounds are inclusive. A bare `YYYY-MM-DD` end bound therefore covers
    the whole of that day: it is returned as the following midnight, and
    callers filter with `<` rather than `<=`.

    Parsing it as midnight and filtering `<=` -- which is what this server did
    everywhere -- silently dropped the last day of every range, so "this
    month" quietly meant "this month minus its last day".

    A value carrying a time is used exactly as given, on the assumption that a
    caller precise enough to name a time meant it.
    """
    if value is None:
        return None
    text = value.strip()
    try:
        parsed = datetime.fromisoformat(text)
    except (ValueError, TypeError):
        raise invalid_format(
            param,
            value,
            "an ISO-8601 date (YYYY-MM-DD) or timestamp",
            example="2026-09-19",
            hint="Both from_date and to_date are inclusive.",
        ) from None

    # Date-only iff the string carries no time part. Testing for a time
    # separator rather than a length: '20260919' is a valid ISO date too, and
    # a length check silently treated it as a timestamp and skipped the
    # end-of-day advance -- reintroducing the dropped-last-day bug for
    # exactly that format.
    is_bare_date = "T" not in text and ":" not in text
    if end and is_bare_date:
        return parsed + timedelta(days=1)
    return parsed


@contextmanager
def get_db():
    """
    Context manager for database sessions.
    Ensures proper cleanup after each tool invocation.

    Usage:
        with get_db() as db:
            result = db.query(Model).all()
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
