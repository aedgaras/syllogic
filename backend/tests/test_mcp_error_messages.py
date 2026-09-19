"""What a failed tool call is allowed to say, and what it must say.

Two rules, and they pull in opposite directions.

**Nothing from the database gets out.** Every mutation tool used to answer a
failed write with `f"Database error: {str(e)}"`. A SQLAlchemy exception
string quotes the failing statement, the table and column names, the
constraint that rejected the write, and frequently a row value -- so this
handed the schema, and some of the data, to whatever is on the other end of
the tool call. For a hosted client that is a third-party API. `ToolCallLogger`
already refuses to log tool *arguments* for exactly this reason; these tests
close the other direction, and assert the correlation id that makes the
terser message supportable.

**Everything the caller needs does.** The opposite failure is a message so
careful it is useless: "Invalid period" tells an agent nothing it did not
already know, so it retries with another guess. The message has to carry the
way out -- the allowed values, the candidate ids, the expected format.

Between them sits the convention itself: failures raise, and a returned value
means the call worked. A `{"success": False}` payload is a second source of
truth, and the failure mode is the bad one -- a caller that forgets to check
reads an error body as data.
"""

from __future__ import annotations

import re

import pytest
from fastmcp.exceptions import ToolError
from sqlalchemy.exc import IntegrityError

from app.mcp.errors import (
    invalid_enum,
    invalid_format,
    invalid_uuid,
    missing_argument,
    not_found,
    out_of_range,
    raise_database_error,
    raise_dispatch_error,
)
from app.mcp.tools import budgets as budget_tools
from app.mcp.tools import categories as category_tools
from app.mcp.tools import reports as report_tools
from app.mcp.tools import transactions as tx_tools


TOOL_MODULES = [budget_tools, category_tools, report_tools, tx_tools]


# Fragments that mean an exception string escaped into the response.
LEAK_PATTERN = re.compile(
    r"SELECT |INSERT |UPDATE |DELETE FROM |relation |column |constraint |"
    r"psycopg|sqlalchemy|Traceback|\[SQL:|violates ",
    re.IGNORECASE,
)


# A realistic exception: the text below is the shape psycopg actually
# produces, and is exactly what used to be interpolated into the response.
def _realistic_db_error() -> IntegrityError:
    return IntegrityError(
        statement="INSERT INTO budgets (id, user_id, name, amount) VALUES (%(id)s, ...)",
        params={"user_id": "user-123", "name": "Groceries", "amount": 400},
        orig=Exception(
            'duplicate key value violates unique constraint "budgets_user_id_name_key"\n'
            "DETAIL:  Key (user_id, name)=(user-123, Groceries) already exists."
        ),
    )


def _raise_and_capture(raiser, *args) -> str:
    with pytest.raises(ToolError) as excinfo:
        raiser(*args)
    return str(excinfo.value)


# ---------------------------------------------------------------------------
# Nothing from the infrastructure gets out
# ---------------------------------------------------------------------------


def test_database_error_raises_rather_than_returning():
    """A failure has to be a failure, not a dict the caller might read as data."""
    with pytest.raises(ToolError):
        raise_database_error("create_budget", _realistic_db_error())


def test_database_error_does_not_echo_the_exception():
    message = _raise_and_capture(raise_database_error, "create_budget", _realistic_db_error())
    assert not LEAK_PATTERN.search(message), message


@pytest.mark.parametrize(
    "fragment",
    [
        "budgets_user_id_name_key",
        "user-123",
        "Groceries",
        "INSERT INTO",
    ],
)
def test_no_fragment_of_the_original_survives(fragment):
    message = _raise_and_capture(raise_database_error, "create_budget", _realistic_db_error())
    assert fragment not in message


def test_the_reference_is_present_and_usable():
    """The id is what makes a message with no detail supportable."""
    message = _raise_and_capture(raise_database_error, "create_budget", _realistic_db_error())
    assert re.search(r"Reference: ([0-9a-f]{12})", message), message


def test_references_are_unique_per_failure():
    a = _raise_and_capture(raise_database_error, "create_budget", _realistic_db_error())
    b = _raise_and_capture(raise_database_error, "create_budget", _realistic_db_error())
    assert a != b


def test_the_full_exception_still_reaches_the_log(caplog):
    with caplog.at_level("ERROR", logger="app.mcp.errors"):
        message = _raise_and_capture(raise_database_error, "create_budget", _realistic_db_error())

    ref = re.search(r"Reference: ([0-9a-f]{12})", message).group(1)
    assert ref in caplog.text
    assert "tool=create_budget" in caplog.text
    # The detail withheld from the caller is present for whoever is on call.
    assert "budgets_user_id_name_key" in caplog.text


def test_dispatch_error_does_not_echo_the_broker_url():
    """ReportDispatchError interpolates the broker exception, password and all."""
    exc = Exception("Error 111 connecting to redis://:hunter2@broker.internal:6379/0.")
    message = _raise_and_capture(raise_dispatch_error, "send_test_report", exc)

    assert "hunter2" not in message
    assert "broker.internal" not in message
    assert "redis://" not in message
    assert re.search(r"Reference: ([0-9a-f]{12})", message), message


# ---------------------------------------------------------------------------
# Everything the caller needs does
# ---------------------------------------------------------------------------


def test_invalid_enum_inlines_every_allowed_value():
    """The whole point: the agent fixes the call instead of guessing again."""
    message = str(invalid_enum("period", "fortnightly", ("monthly", "weekly", "yearly")))

    for allowed in ("monthly", "weekly", "yearly"):
        assert allowed in message
    assert "fortnightly" in message


def test_not_found_names_candidates_and_their_ids():
    candidates = [("Groceries", "aaaa-1"), ("Transport", "bbbb-2")]
    message = str(not_found("budget", "nope", candidates=candidates, tool="list_budgets"))

    assert "Groceries" in message
    assert "aaaa-1" in message
    assert "Transport" in message


def test_not_found_stops_listing_and_points_at_the_tool():
    """Fifty candidates in an error message is noise, not help."""
    candidates = [(f"Category {i}", f"id-{i}") for i in range(50)]
    message = str(not_found("category", "nope", candidates=candidates, tool="list_categories"))

    assert "id-0" in message
    assert "id-49" not in message
    assert "30 more" in message
    assert "list_categories()" in message


def test_not_found_without_candidates_still_says_where_to_look():
    """Transactions are too numerous to list, so the tool name is the whole hint."""
    message = str(not_found("transaction", "nope", tool="search_transactions"))
    assert "search_transactions()" in message


def test_invalid_uuid_shows_the_shape_expected():
    message = str(invalid_uuid("account_id", "acct-7"))
    assert "acct-7" in message
    assert re.search(r"[0-9a-f]{8}-[0-9a-f]{4}-", message), message


def test_out_of_range_states_the_bound_that_was_crossed():
    assert "2000" in str(out_of_range("transaction_ids length", 5000, maximum=2000))
    assert "0" in str(out_of_range("period_offset", -1, minimum=0))


def test_missing_argument_says_what_would_satisfy_it():
    message = str(missing_argument("queries", "at least one search string is required"))
    assert "queries" in message
    assert "at least one" in message


def test_echoed_values_are_truncated():
    """An error message quotes caller input; a caller that pasted a blob
    into a uuid field gets an error, not its blob back."""
    message = str(invalid_format("account_id", "x" * 10_000, "a UUID"))
    assert len(message) < 400


# ---------------------------------------------------------------------------
# One convention
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("module", TOOL_MODULES, ids=lambda m: m.__name__)
def test_no_module_still_formats_an_exception_into_a_response(module):
    """Guards against the pattern coming back in a new tool."""
    source = open(module.__file__).read()
    assert "Database error: {str(e)}" not in source
    assert 'f"Database error' not in source


@pytest.mark.parametrize("module", TOOL_MODULES, ids=lambda m: m.__name__)
def test_no_module_returns_a_success_flag_or_an_error_body(module):
    """`{"success": ...}` and `{"error": ...}` are both gone; failures raise."""
    source = open(module.__file__).read()
    assert '"success"' not in source
    assert '"error":' not in source
