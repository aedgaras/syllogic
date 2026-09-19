"""Resources and prompts: what a session gets handed instead of having to ask.

A tool call is a question the agent must know to ask. Nearly every session
opens by asking the same three -- what accounts exist, what categories exist,
what do these numbers mean -- and paying three round trips for answers that do
not change.

Two things these tests hold down.

**The schema resource has to say the things that are otherwise unsayable.**
Chief among them: the effective category is `category_id` when set and
`category_system_id` otherwise. That rule governs every aggregate in the
server and was documented in about three of forty docstrings. An agent that
gets it wrong produces answers that are confident, plausible and wrong.

**A resource is cached, so the cache key had better include the user.**
Getting that wrong is a data leak rather than a slow response.

(The middleware side of this -- resources counting against the same rate
limit and landing in the same log -- lives in test_mcp_middleware.py, with
the rest of the middleware cases.)
"""

from __future__ import annotations

from decimal import Decimal
from unittest.mock import patch

import pytest

from app.mcp import prompts as mcp_prompts
from app.mcp import resources as mcp_resources
from app.models import Account, Category, Person, User


USER_ID = "resource-user"


@pytest.fixture(autouse=True)
def _clear_resource_cache():
    mcp_resources.clear_cache()
    yield
    mcp_resources.clear_cache()


@pytest.fixture
def seeded(db_session):
    user = User(id=USER_ID, email="res@test.com", functional_currency="EUR")
    db_session.add(user)
    db_session.flush()

    db_session.add_all(
        [
            Account(
                user_id=user.id,
                name="Main",
                account_type="checking",
                currency="EUR",
                institution="Bank",
                balance_available=Decimal("1234.56"),
                functional_balance=Decimal("1234.56"),
            ),
            Person(user_id=user.id, name="Alex", kind="adult"),
        ]
    )
    parent = Category(user_id=user.id, name="Food", category_type="expense")
    db_session.add(parent)
    db_session.flush()
    db_session.add(
        Category(
            user_id=user.id,
            name="Groceries",
            category_type="expense",
            parent_id=parent.id,
            categorization_instructions="Supermarkets only.",
        )
    )
    db_session.commit()
    return user


# ---------------------------------------------------------------------------
# The schema document
# ---------------------------------------------------------------------------


def test_schema_states_which_category_field_wins():
    """The single most consequential rule in the data model."""
    doc = mcp_resources.SCHEMA_DOC

    assert "category_id" in doc
    assert "category_system_id" in doc
    # Not merely mentioned -- stated as a precedence rule.
    assert "otherwise" in doc.lower()


@pytest.mark.parametrize(
    "claim",
    [
        "major units",  # amounts are euros, not cents
        "inclusive",  # date bounds
        "currency",  # never inferred
        "unconverted",  # excluded rows are declared
        "dry_run",  # writes preview
        "idempotency_key",  # retries are safe
    ],
)
def test_schema_covers_what_a_response_cannot_tell_you(claim):
    assert claim in mcp_resources.SCHEMA_DOC


# ---------------------------------------------------------------------------
# The data resources
# ---------------------------------------------------------------------------


def _read(mcp, uri: str) -> str:
    import asyncio

    async def go():
        resource = await mcp.get_resource(uri)
        return await resource.read()

    return asyncio.run(go())


@pytest.fixture
def mcp_with_user(seeded):
    """The server, with the bearer-token lookup pinned to the seeded user."""
    import app.mcp.server as srv

    with patch("app.mcp.resources.get_mcp_user_id", return_value=USER_ID):
        yield srv.mcp


def test_accounts_resource_omits_balances(mcp_with_user):
    """A cached balance is stale by construction, and "your balance is X"
    where X is an hour old is worse than one more tool call."""
    body = _read(mcp_with_user, "syllogic://accounts")

    assert "Main" in body
    assert "1234.56" not in body
    assert "balance" not in body


def test_accounts_resource_keeps_what_does_not_move(mcp_with_user):
    body = _read(mcp_with_user, "syllogic://accounts")

    assert "checking" in body
    assert "EUR" in body
    assert "Bank" in body


def test_categories_resource_carries_the_users_own_rules(mcp_with_user):
    """Those instructions are what the user has taught the system; an agent
    that has not read them will re-derive them, differently."""
    body = _read(mcp_with_user, "syllogic://categories")

    assert "Supermarkets only." in body
    # Tree shape survives.
    assert "children" in body


def test_people_resource_lists_the_household(mcp_with_user):
    assert "Alex" in _read(mcp_with_user, "syllogic://people")


def test_resources_are_cached_per_user(mcp_with_user, db_session):
    """Second read inside the TTL does not re-query."""
    first = _read(mcp_with_user, "syllogic://people")

    db_session.add(Person(user_id=USER_ID, name="Sam", kind="adult"))
    db_session.commit()

    assert _read(mcp_with_user, "syllogic://people") == first
    mcp_resources.clear_cache()
    assert "Sam" in _read(mcp_with_user, "syllogic://people")


def test_one_users_cache_is_not_served_to_another(seeded, db_session):
    """The cache key includes the user. Getting this wrong is a data leak,
    not a slow response."""
    import app.mcp.server as srv

    other = User(id="other-resource-user", email="other@test.com")
    db_session.add(other)
    db_session.flush()
    db_session.add(Person(user_id=other.id, name="Nobody", kind="adult"))
    db_session.commit()

    with patch("app.mcp.resources.get_mcp_user_id", return_value=USER_ID):
        mine = _read(srv.mcp, "syllogic://people")
    with patch("app.mcp.resources.get_mcp_user_id", return_value=other.id):
        theirs = _read(srv.mcp, "syllogic://people")

    assert "Alex" in mine and "Nobody" not in mine
    assert "Nobody" in theirs and "Alex" not in theirs


# ---------------------------------------------------------------------------
# Inventory
# ---------------------------------------------------------------------------


def test_the_expected_resources_are_registered():
    import asyncio
    import app.mcp.server as srv

    uris = {str(r.uri) for r in asyncio.run(srv.mcp._list_resources())}
    assert uris == {
        "syllogic://schema",
        "syllogic://accounts",
        "syllogic://categories",
        "syllogic://people",
    }


def test_the_expected_prompts_are_registered():
    import asyncio
    import app.mcp.server as srv

    names = {p.name for p in asyncio.run(srv.mcp._list_prompts())}
    assert names == {
        "categorize_uncategorized",
        "month_end_close",
        "budget_review",
        "spending_investigation",
    }


def test_the_instructions_string_stayed_short():
    """It is paid for on every session. The workflows moved to prompts and
    the field semantics to syllogic://schema precisely so this could shrink."""
    import app.mcp.server as srv

    assert len(srv.mcp.instructions.strip().splitlines()) < 40


# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------


def _render(name: str, **kwargs) -> str:
    import asyncio

    class _Collector:
        def __init__(self):
            self.fns = {}

        def prompt(self, *, name, description):
            def deco(fn):
                self.fns[name] = fn
                return fn

            return deco

    collector = _Collector()
    mcp_prompts.register(collector)
    result = collector.fns[name](**kwargs)
    return asyncio.run(result) if hasattr(result, "__await__") else result


def test_categorize_prompt_insists_on_a_preview():
    """These are the user's records and the agent has not shown them the rows."""
    body = _render("categorize_uncategorized", limit=50)

    assert "dry_run=True" in body
    assert "Do not skip" in body
    assert "50" in body


def test_categorize_prompt_warns_off_substring_matching():
    assert 'match_mode="word"' in _render("categorize_uncategorized")


def test_month_end_prompt_chases_the_numbers_that_hide_gaps():
    body = _render("month_end_close", month="2026-08")

    assert "2026-08" in body
    assert "unconverted_transaction_count" in body
    assert "include_uncategorized=True" in body


def test_budget_review_prompt_grounds_changes_in_history():
    """A limit set from one bad month is how a budget stops meaning anything."""
    body = _render("budget_review", period_offset=1)

    assert "get_budget_history" in body
    assert "average_spent_completed" in body


def test_spending_investigation_prompt_names_the_recategorization_trap():
    body = _render("spending_investigation", category_id="abc", months=3)

    assert "abc" in body
    assert "3" in body
    assert "category_system_id" in body
