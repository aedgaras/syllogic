"""Row-level and non-transaction totals must name their currency too.

Phase 1 fixed the analytics aggregates, which sum `transactions` and have a
stored `functional_amount` to lean on. Three totals were left summing raw
amounts with no conversion available at all:

- `get_recurring_summary` added every subscription's `amount` together.
  RecurringTransaction has no `functional_amount`, so a $20/month service and
  a 20 EUR/month service contributed the same 20 to one unlabelled number.
- `get_household_summary` added account balances to property and vehicle
  valuations, each carrying its own currency, into a "net worth" figure.
- The same tool read `float(a.functional_balance or 0)`, so an account that
  could not be converted was counted as *empty* rather than as uncounted --
  the failure that looks most like a fact.

The rule is the one Phase 1 settled on: convert what can be converted, leave
out what cannot, name the currency, and report the count left out. A total
the caller knows is incomplete is worth more than one that is quietly wrong.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

import pytest

from app.mcp.tools import people as people_tools
from app.mcp.tools import recurring as recurring_tools
from app.models import (
    Account,
    ExchangeRate,
    Person,
    Property,
    RecurringTransaction,
    User,
)


USER_ID = "currency-label-user"


@pytest.fixture
def usd_to_eur(db_session):
    """One rate on record: USD -> EUR at 0.90. GBP deliberately has none."""
    db_session.add(
        ExchangeRate(
            date=datetime(2026, 4, 1),
            base_currency="USD",
            target_currency="EUR",
            rate=Decimal("0.90"),
        )
    )
    db_session.flush()


@pytest.fixture
def subs(db_session, usd_to_eur):
    """Three monthly subscriptions: EUR, USD (convertible), GBP (not)."""
    user = User(id=USER_ID, email="cl@test.com", functional_currency="EUR")
    db_session.add(user)
    db_session.flush()

    db_session.add_all(
        [
            RecurringTransaction(
                user_id=user.id,
                name="EUR service",
                amount=Decimal("10.00"),
                currency="EUR",
                frequency="monthly",
                is_active=True,
            ),
            RecurringTransaction(
                user_id=user.id,
                name="USD service",
                amount=Decimal("100.00"),
                currency="USD",
                frequency="monthly",
                is_active=True,
            ),
            RecurringTransaction(
                user_id=user.id,
                name="GBP service",
                amount=Decimal("50.00"),
                currency="GBP",
                frequency="monthly",
                is_active=True,
            ),
        ]
    )
    db_session.commit()
    return user


def test_recurring_summary_converts_before_it_adds(subs):
    """10 EUR + (100 USD * 0.90) = 100 EUR. The old code returned 160."""
    result = recurring_tools.get_recurring_summary(USER_ID)

    assert result["currency"] == "EUR"
    assert result["total_monthly_cost"] == 100.0
    assert result["total_yearly_cost"] == 1200.0


def test_recurring_summary_excludes_and_counts_what_it_cannot_convert(subs):
    """The GBP row has no rate on record, so it is left out and declared."""
    result = recurring_tools.get_recurring_summary(USER_ID)

    assert result["unconverted_count"] == 1
    # It is still counted as an active subscription -- it exists, it just
    # cannot be added up.
    assert result["total_active"] == 3
    assert 50.0 not in [e["amount"] for e in result["by_importance"][3]]


def test_recurring_summary_keeps_the_native_amount_alongside(subs):
    """Converted figures are for adding up; the native one is what the user
    actually pays, and losing it would make the row unrecognisable."""
    by_name = {
        e["name"]: e for e in recurring_tools.get_recurring_summary(USER_ID)["by_importance"][3]
    }

    usd = by_name["USD service"]
    assert usd["amount"] == 90.0
    assert usd["currency"] == "EUR"
    assert usd["native_amount"] == 100.0
    assert usd["native_currency"] == "USD"


def test_recurring_summary_by_frequency_totals_are_converted(subs):
    monthly = recurring_tools.get_recurring_summary(USER_ID)["by_frequency"]["monthly"]

    assert monthly["count"] == 2  # the GBP row is not in the total
    assert monthly["total"] == 100.0
    assert monthly["monthly_equivalent"] == 100.0


# ---------------------------------------------------------------------------
# Household net worth
# ---------------------------------------------------------------------------


@pytest.fixture
def household(db_session, usd_to_eur):
    """One person owning a convertible account, an unconvertible one, and a
    property valued in USD."""
    user = User(id=USER_ID, email="cl@test.com", functional_currency="EUR")
    db_session.add(user)
    db_session.flush()

    person = Person(user_id=user.id, name="Alex", kind="adult")
    db_session.add(person)

    convertible = Account(
        user_id=user.id,
        name="Main",
        account_type="checking",
        currency="EUR",
        balance_available=Decimal("1000.00"),
        functional_balance=Decimal("1000.00"),
    )
    # No functional_balance: the account could not be stated in EUR.
    unconvertible = Account(
        user_id=user.id,
        name="Offshore",
        account_type="checking",
        currency="GBP",
        balance_available=Decimal("5000.00"),
        functional_balance=None,
    )
    house = Property(
        user_id=user.id,
        name="House",
        property_type="residential",
        current_value=Decimal("200000.00"),
        currency="USD",
        is_active=True,
    )
    db_session.add_all([convertible, unconvertible, house])
    db_session.commit()
    return user, person, convertible, unconvertible, house


def _own(db_session, table, entity_id, person_id):
    from app.models import AccountOwner, PropertyOwner

    model = {"account": AccountOwner, "property": PropertyOwner}[table]
    column = f"{table}_id"
    db_session.add(model(**{column: entity_id, "person_id": person_id, "share": Decimal("1.0")}))


def test_household_summary_converts_valuations_into_the_functional_currency(household, db_session):
    user, person, convertible, _unconvertible, house = household
    _own(db_session, "account", convertible.id, person.id)
    _own(db_session, "property", house.id, person.id)
    db_session.commit()

    result = people_tools.get_household_summary(user.id)
    entry = result["people"][0]

    assert result["currency"] == "EUR"
    assert entry["currency"] == "EUR"
    assert entry["cash"] == 1000.0
    # 200,000 USD at 0.90, not 200,000 added to euros as-is.
    assert entry["properties"] == 180000.0
    assert entry["total"] == 181000.0


def test_household_summary_counts_an_unconvertible_account_rather_than_zeroing_it(
    household, db_session
):
    """`float(x or 0)` turned "cannot be converted" into "is empty", which
    reads as a fact about the account rather than a gap in the answer."""
    user, person, convertible, unconvertible, _house = household
    _own(db_session, "account", convertible.id, person.id)
    _own(db_session, "account", unconvertible.id, person.id)
    db_session.commit()

    result = people_tools.get_household_summary(user.id)

    assert result["people"][0]["cash"] == 1000.0
    assert result["unconverted"]["accounts"] == 1


def test_household_summary_counts_each_asset_once_not_once_per_owner(household, db_session):
    """Two owners of one unconvertible account is one uncounted asset."""
    user, person, _convertible, unconvertible, _house = household
    second = Person(user_id=user.id, name="Sam", kind="adult")
    db_session.add(second)
    db_session.flush()
    _own(db_session, "account", unconvertible.id, person.id)
    _own(db_session, "account", unconvertible.id, second.id)
    db_session.commit()

    result = people_tools.get_household_summary(user.id)

    assert result["unconverted"]["accounts"] == 1
