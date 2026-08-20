from __future__ import annotations

from uuid import uuid4

import pytest

from app.models import (
    User,
    Person,
    Account,
    AccountOwner,
)
from app.services.grounding import collect_grounding


@pytest.fixture
def seeded_user_with_investment_account(db_session):
    uid = f"u_{uuid4()}"
    user = User(id=uid, email=f"{uid}@example.com", name="T", email_verified=True)
    db_session.add(user)
    db_session.flush()
    self_p = Person(user_id=uid, name="Self", kind="self")
    db_session.add(self_p)
    db_session.flush()
    acct = Account(
        user_id=uid,
        name="My Investments",
        account_type="investment_manual",
        currency="EUR",
        functional_balance=1234,
        balance_available=1234,
    )
    db_session.add(acct)
    db_session.flush()
    db_session.add(AccountOwner(account_id=acct.id, person_id=self_p.id, share=None))
    db_session.commit()
    return uid


def test_collects_idle_cash_for_investment_account(seeded_user_with_investment_account, db_session):
    uid = seeded_user_with_investment_account
    out = collect_grounding(uid)
    assert len(out["cashSnapshot"]) == 1
    snap = out["cashSnapshot"][0]
    assert snap["accountName"] == "My Investments"
    # No holdings, so idleCash equals balance.
    assert snap["idleCash"] == pytest.approx(1234)


def test_recent_activity_always_empty(seeded_user_with_investment_account):
    """Manual holdings have no trade-import data source, so recentActivity
    is always empty; the key is kept for API stability."""
    uid = seeded_user_with_investment_account
    out = collect_grounding(uid, days=30)
    assert out["recentActivity"] == []


def test_no_data_returns_empty_lists(db_session):
    """A user with no investment accounts gets empty grounding (not an error)."""
    uid = f"u_{uuid4()}"
    user = User(id=uid, email=f"{uid}@example.com", name="T", email_verified=True)
    db_session.add(user)
    db_session.commit()
    out = collect_grounding(uid)
    assert out["cashSnapshot"] == []
    assert out["recentActivity"] == []
