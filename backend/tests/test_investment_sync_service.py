from datetime import date, datetime
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.models import (
    Account,
    Holding,
    PriceSnapshot,
    HoldingValuation,
    AccountBalance,
    User,
)
from app.services.investment_sync_service import InvestmentSyncService


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:")
    for model in (
        User,
        Account,
        Holding,
        PriceSnapshot,
        HoldingValuation,
        AccountBalance,
    ):
        model.__table__.create(bind=engine)
    with Session(engine) as session:
        yield session


def test_sync_manual_prices_and_revalues_holdings(db):
    user = User(id="u1", email="u@example.com", functional_currency="EUR")
    acc = Account(
        id=uuid4(), user_id="u1", name="My Investments", account_type="investment_manual", currency="EUR"
    )
    holding = Holding(
        id=uuid4(),
        user_id="u1",
        account_id=acc.id,
        symbol="AAPL",
        currency="USD",
        instrument_type="equity",
        quantity="10",
        avg_cost="150",
        source="manual",
    )
    db.add_all([user, acc, holding])
    db.commit()

    fx = MagicMock()
    fx.convert.side_effect = lambda amt, src, dst, on: amt

    price_service = MagicMock()
    price_service.get_or_fetch.return_value = {}

    valuation_service = MagicMock()

    svc = InvestmentSyncService(
        db=db, fx=fx, price_service=price_service, valuation_service=valuation_service
    )
    svc.sync_account(acc.id, on=date(2026, 4, 18))

    price_service.get_or_fetch.assert_called_once_with(["AAPL"], date(2026, 4, 18))
    valuation_service.compute.assert_called_once_with(account_id=acc.id, on=date(2026, 4, 18))

    db.refresh(acc)
    assert acc.last_synced_at is not None


def test_sync_rejects_non_manual_account(db):
    user = User(id="u1", email="u@example.com", functional_currency="EUR")
    acc = Account(
        id=uuid4(), user_id="u1", name="Checking", account_type="checking", currency="EUR"
    )
    db.add_all([user, acc])
    db.commit()

    fx = MagicMock()
    svc = InvestmentSyncService(db=db, fx=fx, price_service=MagicMock(), valuation_service=MagicMock())
    with pytest.raises(ValueError):
        svc.sync_account(acc.id, on=date(2026, 4, 18))
