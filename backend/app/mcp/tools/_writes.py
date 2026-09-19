"""Shared machinery for the MCP write tools.

Three problems, one module, because they all turn on the same question: what
does the agent know about a write it cannot see?

**Previews (`dry_run`).** An agent asked to "recategorise my groceries" is
about to change rows the user has not looked at. It should be able to show
the change first. `bulk_update_transaction_categories` already worked this
way; `preview_or_commit` generalises it. The preview is built by applying the
write for real and rolling it back, not by describing what would happen --
that is what makes it trustworthy. A "would set amount to -5" string cannot
notice a CHECK constraint; a flush can.

**Retries (`idempotency_key`).** An agent that loses the response to
`create_report` cannot tell a call that failed from one that succeeded and
went unheard. Retrying is the reasonable thing to do and it is also what
creates the duplicate. A key makes the retry safe.

**Reporting the change (`before`/`after`).** A mutation that answers with the
new state alone cannot be distinguished from one that changed nothing, so an
agent says "I've updated that" either way. `mutation_result` carries both
sides and the field list, so "already set to 400" is sayable.
"""

from __future__ import annotations

import hashlib
import json
from contextlib import contextmanager
from typing import Any, Callable, Iterable, Iterator

from fastmcp.exceptions import ToolError
from sqlalchemy.orm import Session

from app.database import engine
from app.models import MCPIdempotencyKey


# ---------------------------------------------------------------------------
# Previews
# ---------------------------------------------------------------------------


def preview_or_commit(
    db: Session,
    dry_run: bool,
    build_response: Callable[[], dict],
) -> dict:
    """Finish a write: commit it, or flush-roll-back it and report the preview.

    `build_response` runs while the write is visible to this session either
    way, so a preview serialises the same objects a real call would -- server
    defaults, generated ids, cascade effects and all.

    The flush is the point of the exercise. Validating and then *not* writing
    would miss every constraint the database enforces, and a preview that
    misses those is worse than none: it tells the agent the call will succeed
    right up until it doesn't.
    """
    if not dry_run:
        db.commit()
        return {**build_response(), "dry_run": False, "committed": True}

    db.flush()
    response = build_response()
    db.rollback()
    return {**response, "dry_run": True, "committed": False}


@contextmanager
def preview_session() -> Iterator[Session]:
    """A session whose commits are undone when the block exits.

    `preview_or_commit` is enough when the tool owns the commit. It is not
    enough for the report tools, which delegate to `report_service`, and that
    service commits internally -- by the time control comes back there is
    nothing left to roll back.

    So the session is bound to a connection-level transaction that the
    service cannot see, with `join_transaction_mode="create_savepoint"`: the
    service's `commit()` calls release savepoints, and the outer transaction
    is rolled back here regardless. The service runs completely unmodified
    and completely undone.

    This is the recipe `tests/conftest.py` warns off, and the warning does
    not apply here: what it rejects is rebinding the *global* SessionLocal so
    that unrelated code paths silently join one shared transaction. This
    session is handed to one call and closed after it.
    """
    connection = engine.connect()
    outer = connection.begin()
    session = Session(bind=connection, join_transaction_mode="create_savepoint")
    try:
        yield session
    finally:
        session.close()
        outer.rollback()
        connection.close()


# ---------------------------------------------------------------------------
# Reporting the change
# ---------------------------------------------------------------------------


def snapshot(obj: Any, fields: Iterable[str]) -> dict:
    """Read `fields` off a model instance into a plain dict.

    Taken before the write and again after, so the two are comparable. Values
    are coerced through `_plain` because Decimal and date do not survive a
    JSON round trip, and these dicts get stored as JSONB by the idempotency
    machinery.
    """
    return {name: _plain(getattr(obj, name, None)) for name in fields}


def mutation_result(before: dict, after: dict, **extra: Any) -> dict:
    """The uniform shape for a single-entity write.

    `changed: False` with equal before/after on a no-op. That case is the
    reason this exists: a tool that answers with the new state alone leaves
    an agent unable to tell "I set it to 400" from "it was already 400", and
    it will claim the edit either way.
    """
    fields_changed = [name for name in after if before.get(name) != after[name]]
    return {
        "changed": bool(fields_changed),
        "before": before,
        "after": after,
        "fields_changed": fields_changed,
        **extra,
    }


def _plain(value: Any) -> Any:
    """JSON-safe rendering of the value types these models actually hold."""
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if isinstance(value, (list, tuple)):
        return [_plain(v) for v in value]
    if isinstance(value, dict):
        return {k: _plain(v) for k, v in value.items()}
    # Decimal and UUID both land here, and both want to keep their precision
    # or their exact spelling rather than becoming a float.
    try:
        return float(value)
    except (TypeError, ValueError):
        return str(value)


# ---------------------------------------------------------------------------
# Retries
# ---------------------------------------------------------------------------


def request_hash(arguments: dict) -> str:
    """A stable fingerprint of the call's arguments.

    `user_id` and `idempotency_key` are excluded: the first is already part
    of the uniqueness constraint, and the second is the label, not the
    payload. Sorted keys and a canonical separator so two dicts that mean the
    same thing hash the same.
    """
    payload = {k: v for k, v in arguments.items() if k not in ("user_id", "idempotency_key")}
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def replay(
    db: Session,
    user_id: str,
    tool: str,
    key: str | None,
    arguments: dict,
) -> tuple[dict | None, str | None]:
    """Look for a stored response for this key.

    Returns `(response, hash)`. A response means: return it, do not execute.
    A hash with no response means: execute, then call `remember` with it.
    `(None, None)` means no key was given and none of this applies.

    A key that arrives with different arguments raises rather than resolving
    the conflict either way. Replaying the old response would be a lie about
    what the caller asked for, and executing the new one would defeat the
    key -- both hide a client bug that the caller can fix.
    """
    if not key:
        return None, None

    digest = request_hash(arguments)
    stored = (
        db.query(MCPIdempotencyKey)
        .filter(
            MCPIdempotencyKey.user_id == user_id,
            MCPIdempotencyKey.tool_name == tool,
            MCPIdempotencyKey.idempotency_key == key,
        )
        .first()
    )
    if stored is None:
        return None, digest

    if stored.request_hash != digest:
        raise ToolError(
            f"idempotency_key {key!r} was already used for {tool}() with different "
            f"arguments. Reusing a key means 'this is the same call as before'; "
            f"use a new key for a different call."
        )

    return {**stored.response, "idempotent_replay": True}, digest


def remember(
    db: Session,
    user_id: str,
    tool: str,
    key: str | None,
    digest: str | None,
    response: dict,
) -> None:
    """Store a response against its key, in its own transaction.

    Committed separately from the write it describes, and deliberately after
    it: if this insert fails the write still stands, and the worst case is a
    retry that writes again -- exactly the behaviour of no key at all. The
    reverse order would let a failed write leave a key claiming it succeeded.
    """
    if not key or digest is None:
        return

    db.add(
        MCPIdempotencyKey(
            user_id=user_id,
            tool_name=tool,
            idempotency_key=key,
            request_hash=digest,
            response=_plain(response),
        )
    )
    db.commit()
