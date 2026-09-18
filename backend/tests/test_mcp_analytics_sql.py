"""The analytics aggregates must bind their values, not interpolate them.

These intercept the database call and inspect the SQL that would have been
sent, so they need no database. The point is twofold: that no caller-supplied
value ever reaches the query text, and that every placeholder left in that
text actually has a value bound to it.
"""

from __future__ import annotations

import re
from contextlib import contextmanager
from unittest.mock import MagicMock, patch

import pytest

from app.mcp.tools import analytics

# A named placeholder, but not the second half of Postgres' `::type` cast.
_PLACEHOLDER = re.compile(r"(?<!:):([a-zA-Z_]\w*)")

# Values that would break out of a quoted literal if they were interpolated.
HOSTILE_USER_ID = "u' OR 1=1; DROP TABLE transactions;--"


class _Captured:
    def __init__(self):
        self.calls = []

    @property
    def sql(self) -> str:
        assert self.calls, "no query was executed"
        return str(self.calls[-1][0])

    @property
    def params(self) -> dict:
        return self.calls[-1][1]


@pytest.fixture
def captured():
    """Run an analytics query against a stub session, capturing the SQL."""
    cap = _Captured()

    def fake_execute(statement, params=None, *args, **kwargs):
        cap.calls.append((statement, params or {}))
        result = MagicMock()
        result.fetchall.return_value = []
        row = MagicMock()
        row.total_income = 0
        row.total_expenses = 0
        result.fetchone.return_value = row
        return result

    session = MagicMock()
    session.execute.side_effect = fake_execute
    session.query.return_value.filter.return_value.all.return_value = []

    @contextmanager
    def fake_get_db():
        yield session

    with patch.object(analytics, "get_db", fake_get_db):
        yield cap


CASES = [
    ("get_spending_by_category", {}),
    ("get_income_by_category", {}),
    ("get_monthly_cashflow", {}),
    ("get_financial_summary", {}),
    (
        "get_spending_by_category",
        {"from_date": "2024-01-01", "to_date": "2024-12-31"},
    ),
    (
        "get_income_by_category",
        {"account_id": "11111111-1111-1111-1111-111111111111"},
    ),
    ("get_monthly_cashflow", {"from_date": "2024-06-01"}),
    ("get_financial_summary", {"to_date": "2024-06-30"}),
    ("get_spending_by_category", {"include_uncategorized": True}),
]


@pytest.mark.parametrize("func_name, kwargs", CASES)
class TestParameterBinding:
    def test_no_caller_value_reaches_the_query_text(self, captured, func_name, kwargs):
        getattr(analytics, func_name)(HOSTILE_USER_ID, **kwargs)
        assert "DROP TABLE" not in captured.sql
        assert "1=1" not in captured.sql
        assert captured.params["user_id"] == HOSTILE_USER_ID

    def test_every_placeholder_is_bound(self, captured, func_name, kwargs):
        getattr(analytics, func_name)(HOSTILE_USER_ID, **kwargs)
        referenced = set(_PLACEHOLDER.findall(captured.sql))
        missing = referenced - set(captured.params)
        assert not missing, f"unbound placeholders: {sorted(missing)}"

    def test_query_has_no_unsubstituted_fragments(self, captured, func_name, kwargs):
        getattr(analytics, func_name)(HOSTILE_USER_ID, **kwargs)
        assert "{" not in captured.sql and "}" not in captured.sql


class TestPersonFilter:
    def test_owned_accounts_are_bound_as_an_array(self, captured):
        owned = ["11111111-1111-1111-1111-111111111111"]
        with patch.object(analytics, "_allowed_account_ids_for", return_value=owned):
            analytics.get_spending_by_category(HOSTILE_USER_ID, person_ids=["p1"])

        assert "ANY(CAST(:person_account_ids AS uuid[]))" in captured.sql
        assert captured.params["person_account_ids"] == owned

    @pytest.mark.parametrize(
        "func_name, empty",
        [
            ("get_spending_by_category", []),
            ("get_income_by_category", []),
            ("get_monthly_cashflow", []),
        ],
    )
    def test_people_owning_no_accounts_return_empty(self, captured, func_name, empty):
        """An empty ownership set means "nothing matches", never "no filter"."""
        with patch.object(analytics, "_allowed_account_ids_for", return_value=[]):
            result = getattr(analytics, func_name)(HOSTILE_USER_ID, person_ids=["p1"])

        assert result == empty
        assert captured.calls == []  # short-circuited before querying

    def test_summary_returns_a_zeroed_shape_when_no_accounts_are_owned(self, captured):
        with patch.object(analytics, "_allowed_account_ids_for", return_value=[]):
            result = analytics.get_financial_summary(HOSTILE_USER_ID, person_ids=["p1"])

        assert result["total_income"] == 0
        assert result["accounts"] == []
        assert captured.calls == []

    def test_no_person_filter_means_no_person_clause(self, captured):
        analytics.get_spending_by_category(HOSTILE_USER_ID)
        assert "person_account_ids" not in captured.sql
        assert "person_account_ids" not in captured.params
