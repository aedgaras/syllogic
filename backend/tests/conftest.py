"""
Shared pytest fixtures for the backend test suite.

Every test gets a clean database: after each test, every application table
is truncated. This is deliberately *not* the classic "wrap the test in a
transaction and roll it back" recipe -- this codebase's routes/services
each open their own `SessionLocal()` and commit independently (there is no
single request-scoped session to hook), including from code the fixture
never sees (Celery tasks, nested service calls). Rebinding `SessionLocal`
onto one shared connection with per-Session SAVEPOINTs was tried and
discarded: a `Session.rollback()` call on a session that hasn't itself
started a transaction falls through to the shared connection and rolls
back *everything*, including other sessions' already-committed work --
exactly the kind of defensive `db.rollback()` calls this test suite already
does routinely (see e.g. test_report_tasks.py). Truncating after the fact
sidesteps that class of bug entirely: every `SessionLocal()` call anywhere
keeps behaving exactly like it does in production.

DATABASE_URL must point at a disposable database -- CI runs this against a
fresh Postgres service container; locally, point it at a scratch database
you don't mind being wiped between every test.
"""

from __future__ import annotations

import base64
import os
import sys

# Ensure the backend/ directory is importable when pytest is run from anywhere.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _set_test_env() -> None:
    """Deterministic encryption keys so blind_index/encrypted fields work in tests."""
    key = base64.urlsafe_b64encode(b"p" * 32).decode("utf-8").rstrip("=")
    os.environ.setdefault("DATA_ENCRYPTION_KEY_CURRENT", key)
    os.environ.setdefault("DATA_ENCRYPTION_KEY_ID", "k-test-conftest")
    os.environ.pop("DATA_ENCRYPTION_KEY_PREVIOUS", None)
    # The broker-trade import runs a yfinance + FX backfill in production to
    # populate historical HoldingValuation / AccountBalance rows. Disable it
    # by default in tests; tests that exercise backfill set it explicitly.
    os.environ.setdefault("BROKER_BACKFILL_ENABLED", "0")


_set_test_env()

import pytest  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.database import Base, SessionLocal, engine  # noqa: E402
from app.security.data_encryption import reset_encryption_config_cache  # noqa: E402
import app.models  # noqa: E402, F401 -- registers every table on Base.metadata


reset_encryption_config_cache()

_ALL_TABLES = [table.name for table in Base.metadata.sorted_tables]


@pytest.fixture(autouse=True)
def _clean_db():
    """Truncate every application table after each test so state never
    leaks between tests, regardless of how many sessions/commits the test
    (or the code it calls) used."""
    try:
        yield
    finally:
        if not _ALL_TABLES:
            return
        with engine.begin() as conn:
            # If a test (or a fixture/helper it calls) leaked a connection
            # holding a transaction open, TRUNCATE would otherwise hang
            # forever waiting on its lock and silently wedge the whole
            # suite. Fail fast and name the blocker instead.
            conn.execute(text("SET LOCAL lock_timeout = '5s'"))
            quoted = ", ".join(f'"{name}"' for name in _ALL_TABLES)
            try:
                conn.execute(text(f"TRUNCATE TABLE {quoted} RESTART IDENTITY CASCADE"))
            except Exception as exc:
                raise RuntimeError(
                    "Post-test TRUNCATE timed out waiting on a lock -- a "
                    "previous test likely leaked an open DB session/transaction. "
                    "Check pg_stat_activity for 'idle in transaction' connections."
                ) from exc


@pytest.fixture
def db_session():
    """Yield a SQLAlchemy session; close on teardown. Actual cleanup happens
    via the `_clean_db` truncation fixture above, not a rollback -- code
    under test may have committed through other sessions this fixture never
    sees."""
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
