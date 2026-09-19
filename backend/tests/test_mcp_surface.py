"""The tool surface: filters, consolidation, and published schemas.

Three threads.

**Filters that were missing.** "Everything over 100 euros", "everything from
this merchant", "these three accounts" all required pulling rows and filtering
client-side, which for a tool budget measured in tokens means not doing it.

**Two tools where one would do.** `search_transactions` and
`search_transactions_multi` were the same search with different arity, and
`get_spending_by_category`/`get_income_by_category` were the same aggregate
with the sign flipped. A caller had to know both before it could pick one, and
every filter added to one had to be added to the other or they would disagree.

**Schemas that say something.** Every tool published
`{"type": "object", "additionalProperties": true}` -- an agent had to call a
tool to learn that tool's response shape, and then guess which fields were
optional.
"""

from __future__ import annotations

import asyncio
from datetime import datetime
from decimal import Decimal

import pytest
from fastmcp.exceptions import ToolError

from app.mcp.tools import transactions as tx_tools
from app.models import Account, Category, Transaction, User


USER_ID = "surface-user"


@pytest.fixture
def rows(db_session):
    user = User(id=USER_ID, email="sf@test.com", functional_currency="EUR")
    db_session.add(user)
    db_session.flush()

    a1 = Account(user_id=user.id, name="Main", account_type="checking", currency="EUR")
    a2 = Account(user_id=user.id, name="Spare", account_type="checking", currency="EUR")
    db_session.add_all([a1, a2])
    db_session.flush()

    groceries = Category(user_id=user.id, name="Groceries", category_type="expense")
    dining = Category(user_id=user.id, name="Dining", category_type="expense")
    db_session.add_all([groceries, dining])
    db_session.flush()

    def txn(account, amount, merchant, category, day=5, system_category=None):
        return Transaction(
            user_id=user.id,
            account_id=account.id,
            amount=Decimal(amount),
            currency="EUR",
            functional_amount=Decimal(amount),
            transaction_type="debit",
            description=f"{merchant} purchase",
            merchant=merchant,
            booked_at=datetime(2026, 9, day),
            category_id=category.id if category else None,
            category_system_id=system_category.id if system_category else None,
            include_in_analytics=True,
        )

    db_session.add_all(
        [
            txn(a1, "-10.00", "Jumbo", groceries, day=1),
            txn(a1, "-150.00", "Albert Heijn", groceries, day=2),
            txn(a2, "-500.00", "Jumbo", dining, day=3),
            # No override; only the AI's assignment. A category filter that
            # reads `category_id` alone will miss this one.
            txn(a2, "-75.00", "ALDI", None, day=4, system_category=groceries),
        ]
    )
    db_session.commit()
    return {"user": user, "a1": a1, "a2": a2, "groceries": groceries, "dining": dining}


def _amounts(result) -> list[float]:
    return sorted(abs(t["amount"]) for t in result["transactions"])


# ---------------------------------------------------------------------------
# New filters
# ---------------------------------------------------------------------------


def test_amount_bounds_work_on_the_magnitude(rows):
    """ "Over 100" has to mean the same thing for an expense and for income,
    or every expense query needs a negative max and a minus-infinity min."""
    assert _amounts(tx_tools.list_transactions(USER_ID, min_amount=100)) == [150.0, 500.0]
    assert _amounts(tx_tools.list_transactions(USER_ID, max_amount=100)) == [10.0, 75.0]
    assert _amounts(tx_tools.list_transactions(USER_ID, min_amount=50, max_amount=200)) == [
        75.0,
        150.0,
    ]


def test_merchant_filter_is_exact_and_case_insensitive(rows):
    """Exact, because the fuzzy version is what search_transactions is for.
    A substring merchant filter would make "Jumbo" a different tool from
    search with extra steps."""
    assert _amounts(tx_tools.list_transactions(USER_ID, merchant="jumbo")) == [10.0, 500.0]
    assert tx_tools.list_transactions(USER_ID, merchant="Jum")["transactions"] == []


def test_account_ids_takes_several(rows):
    both = tx_tools.list_transactions(USER_ID, account_ids=[str(rows["a1"].id), str(rows["a2"].id)])
    one = tx_tools.list_transactions(USER_ID, account_ids=[str(rows["a2"].id)])

    assert len(both["transactions"]) == 4
    assert _amounts(one) == [75.0, 500.0]


def test_category_ids_matches_the_effective_category(rows):
    """The ALDI row has no override, only an AI assignment. Reading
    `category_id` alone undercounts by exactly the transactions the user has
    never had to correct -- which is most of them."""
    result = tx_tools.list_transactions(USER_ID, category_ids=[str(rows["groceries"].id)])

    assert _amounts(result) == [10.0, 75.0, 150.0]


def test_the_singular_id_filters_still_work(rows):
    """Kept as aliases for one release."""
    singular = tx_tools.list_transactions(USER_ID, account_id=str(rows["a2"].id))
    plural = tx_tools.list_transactions(USER_ID, account_ids=[str(rows["a2"].id)])

    assert singular["transactions"] == plural["transactions"]


def test_a_malformed_id_in_a_list_filter_raises(rows):
    """Same rule as the singular form: dropping a bad filter widens the
    result set, and the agent reads the wider answer as the answer."""
    with pytest.raises(ToolError, match="UUID"):
        tx_tools.list_transactions(USER_ID, account_ids=["not-a-uuid"])


def test_search_takes_the_same_filters(rows):
    """The two tools drifting apart is what having one filter definition is
    meant to prevent."""
    result = tx_tools.search_transactions(USER_ID, query="Jumbo", min_amount=100)

    assert _amounts(result) == [500.0]


# ---------------------------------------------------------------------------
# One search tool
# ---------------------------------------------------------------------------


def test_search_accepts_several_queries_in_one_call(rows):
    result = tx_tools.search_transactions(USER_ID, queries=["Jumbo", "ALDI"])

    assert _amounts(result) == [10.0, 75.0, 500.0]


def test_search_reports_which_terms_matched(rows):
    """A caller that searched five merchant spellings needs to know which
    ones were wrong."""
    result = tx_tools.search_transactions(USER_ID, queries=["Jumbo", "Nonesuch"])

    assert result["query_counts"] == {"Jumbo": 2, "Nonesuch": 0}


def test_query_and_queries_combine(rows):
    result = tx_tools.search_transactions(USER_ID, query="ALDI", queries=["Jumbo"])
    assert _amounts(result) == [10.0, 75.0, 500.0]


def test_search_can_filter_with_no_search_term_at_all(rows):
    assert _amounts(tx_tools.search_transactions(USER_ID, merchant="ALDI")) == [75.0]


def test_search_with_neither_term_nor_filter_is_refused(rows):
    """An unbounded search of every transaction the user has ever had is
    never what was meant."""
    with pytest.raises(ToolError, match="query or queries"):
        tx_tools.search_transactions(USER_ID)


def test_word_match_mode_still_avoids_substrings(rows):
    assert (
        tx_tools.search_transactions(USER_ID, query="umbo", match_mode="word")["transactions"] == []
    )
    assert (
        len(tx_tools.search_transactions(USER_ID, query="Jumbo", match_mode="word")["transactions"])
        == 2
    )


def test_the_deprecated_multi_tool_still_answers(rows):
    old = tx_tools.search_transactions_multi(USER_ID, queries=["Jumbo", "ALDI"])
    new = tx_tools.search_transactions(USER_ID, queries=["Jumbo", "ALDI"], limit=100)

    assert old["transactions"] == new["transactions"]


def test_the_deprecated_multi_tool_still_rejects_an_empty_query_list(rows):
    with pytest.raises(ToolError, match="queries"):
        tx_tools.search_transactions_multi(USER_ID, queries=[])


# ---------------------------------------------------------------------------
# Published schemas
# ---------------------------------------------------------------------------


def _tools():
    import app.mcp.server as srv

    return {t.name: t for t in asyncio.run(srv.mcp._list_tools())}


SCHEMA_BEARING = [
    "list_transactions",
    "search_transactions",
    "get_transaction",
    "get_amounts_by_category",
    "list_accounts",
    "get_account",
    "list_categories",
    "get_category",
    "update_category",
    "update_transaction_category",
    "update_budget",
]


@pytest.mark.parametrize("name", SCHEMA_BEARING)
def test_the_migrated_tools_publish_a_real_schema(name):
    """Not `{"type": "object", "additionalProperties": true}`, which is a
    schema that says nothing."""
    schema = _tools()[name].output_schema

    assert schema is not None
    rendered = str(schema)
    assert "$defs" in rendered or "properties" in rendered
    assert schema != {"additionalProperties": True, "type": "object"}


def test_amount_fields_state_their_units():
    """Out by a factor of a hundred looks entirely reasonable."""
    rendered = str(_tools()["list_transactions"].output_schema)

    assert "major units" in rendered
    assert "cents" in rendered


def test_the_category_precedence_rule_is_in_the_schema():
    """The rule that governs every aggregate, stated where a client reads it
    rather than only in a docstring."""
    rendered = str(_tools()["list_transactions"].output_schema)

    assert "category_system_id" in rendered
    assert "precedence" in rendered


def test_the_undercount_field_explains_itself():
    rendered = str(_tools()["get_amounts_by_category"].output_schema)
    assert "undercount" in rendered


# ---------------------------------------------------------------------------
# Deprecations
# ---------------------------------------------------------------------------


DEPRECATED = [
    "search_transactions_multi",
    "get_spending_by_category",
    "get_income_by_category",
]


@pytest.mark.parametrize("name", DEPRECATED)
def test_deprecated_tools_are_still_registered(name):
    """One release of deprecation. Removing on the same day as replacing is
    how an integration breaks between two of its own releases."""
    assert name in _tools()


@pytest.mark.parametrize("name", DEPRECATED)
def test_deprecated_tools_say_so_first(name):
    """First line, so a client truncating the description still sees it."""
    description = _tools()[name].description or ""
    assert description.strip().startswith("DEPRECATED")


@pytest.mark.parametrize("name", DEPRECATED)
def test_deprecated_tools_name_their_replacement(name):
    description = _tools()[name].description or ""
    assert "search_transactions(" in description or "get_amounts_by_category(" in description
