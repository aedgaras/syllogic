"""Database exception text must not reach the client.

Every mutation tool used to answer a failed write with
`f"Database error: {str(e)}"`. A SQLAlchemy exception string quotes the
failing statement, the table and column names, the constraint that rejected
the write, and frequently a row value -- so this handed the schema, and some
of the data, to whatever is on the other end of the tool call. For a hosted
client that is a third-party API.

`ToolCallLogger` already refuses to log tool *arguments* for exactly this
reason. These tests close the other direction, and assert the correlation id
that makes the terser message supportable.
"""

from __future__ import annotations

import re

import pytest
from sqlalchemy.exc import IntegrityError

from app.mcp.errors import database_error
from app.mcp.tools import budgets as budget_tools
from app.mcp.tools import categories as category_tools
from app.mcp.tools import reports as report_tools
from app.mcp.tools import transactions as tx_tools


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


def test_database_error_does_not_echo_the_exception():
    result = database_error("create_budget", _realistic_db_error())

    assert result["success"] is False
    assert not LEAK_PATTERN.search(result["error"]), result["error"]


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
    result = database_error("create_budget", _realistic_db_error())
    assert fragment not in result["error"]


def test_the_reference_is_present_and_usable():
    """The id is what makes a message with no detail supportable."""
    result = database_error("create_budget", _realistic_db_error())

    match = re.search(r"Reference: ([0-9a-f]{12})", result["error"])
    assert match, result["error"]


def test_references_are_unique_per_failure():
    a = database_error("create_budget", _realistic_db_error())["error"]
    b = database_error("create_budget", _realistic_db_error())["error"]
    assert a != b


def test_the_full_exception_still_reaches_the_log(caplog):
    with caplog.at_level("ERROR", logger="app.mcp.errors"):
        result = database_error("create_budget", _realistic_db_error())

    ref = re.search(r"Reference: ([0-9a-f]{12})", result["error"]).group(1)
    logged = caplog.text
    assert ref in logged
    assert "tool=create_budget" in logged
    # The detail withheld from the caller is present for whoever is on call.
    assert "budgets_user_id_name_key" in logged


@pytest.mark.parametrize(
    "module",
    [budget_tools, category_tools, report_tools, tx_tools],
)
def test_no_module_still_formats_an_exception_into_a_response(module):
    """Guards against the pattern coming back in a new tool."""
    source = open(module.__file__).read()
    assert "Database error: {str(e)}" not in source
    assert 'f"Database error' not in source
