"""Route-level tests for /api/forecast/cashflow.

Run with:
    cd backend && .venv/bin/pytest tests/test_forecast_routes.py -v
"""

import hashlib
import hmac
import json
import time
from datetime import date, datetime, timedelta
from decimal import Decimal
from uuid import uuid4

import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base, get_db
from app.main import app
from app.models import Account, RecurringTransaction, Transaction, User

INTERNAL_AUTH_SECRET = "test-internal-secret"

# Account/RecurringTransaction/Transaction use Postgres-only column types
# (JSONB with `::jsonb` server defaults), which SQLite can't render — so
# unlike test_investments_routes.py's in-memory SQLite fixture, this needs a
# real Postgres. Point at FORECAST_TEST_DATABASE_URL if set (e.g. a
# disposable container), else skip rather than touch the shared dev DB.
_TEST_DATABASE_URL = os.getenv("FORECAST_TEST_DATABASE_URL")


def _signed_headers(
    method: str, path_with_query: str, user_id: str = "u1", body: bytes = b""
) -> dict:
    timestamp = str(int(time.time()))
    payload = "\n".join(
        [method.upper(), path_with_query, user_id, timestamp, hashlib.sha256(body).hexdigest()]
    )
    signature = hmac.new(
        INTERNAL_AUTH_SECRET.encode("utf-8"),
        payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return {
        "x-syllogic-user-id": user_id,
        "x-syllogic-timestamp": timestamp,
        "x-syllogic-signature": signature,
    }


class SigningClient:
    def __init__(self, client: TestClient):
        self._client = client

    def request(self, method: str, url: str, **kwargs):
        headers = dict(kwargs.pop("headers", {}) or {})
        body = b""
        if "json" in kwargs:
            body = json.dumps(kwargs.pop("json"), separators=(",", ":")).encode("utf-8")
            kwargs["content"] = body
            headers["content-type"] = "application/json"
        headers.update(_signed_headers(method, url, body=body))
        return self._client.request(method, url, headers=headers, **kwargs)

    def get(self, url, **kw):
        return self.request("GET", url, **kw)


@pytest.fixture
def db():
    if not _TEST_DATABASE_URL:
        pytest.skip(
            "FORECAST_TEST_DATABASE_URL not set - point it at a disposable Postgres "
            "to run these route tests (they need real JSONB/Postgres DDL support)."
        )
    engine = create_engine(_TEST_DATABASE_URL)
    with engine.begin() as conn:
        conn.exec_driver_sql("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
    Base.metadata.create_all(bind=engine)
    with Session(engine) as session:
        yield session
    engine.dispose()


@pytest.fixture
def client(db, monkeypatch):
    monkeypatch.setenv("INTERNAL_AUTH_SECRET", INTERNAL_AUTH_SECRET)
    db.add(User(id="u1", email="u@example.com", functional_currency="EUR"))
    db.commit()
    app.dependency_overrides[get_db] = lambda: db
    monkeypatch.setattr("app.routes.forecast.get_user_id", lambda x=None: "u1")
    yield SigningClient(TestClient(app))
    app.dependency_overrides.clear()


def test_cashflow_forecast_uses_current_balance_and_recurring(client, db):
    account = Account(
        id=uuid4(),
        user_id="u1",
        name="Checking",
        account_type="checking",
        currency="EUR",
        functional_balance=Decimal("1000"),
        is_active=True,
    )
    db.add(account)
    db.add(
        RecurringTransaction(
            id=uuid4(),
            user_id="u1",
            account_id=account.id,
            name="Rent",
            amount=Decimal("500"),
            frequency="monthly",
            is_active=True,
            next_due_date=date.today() + timedelta(days=5),
        )
    )
    db.commit()

    r = client.get("/api/forecast/cashflow?horizon_days=30")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["startingBalance"] == 1000.0
    assert body["projectedBalanceAtHorizon"] == 500.0
    assert len(body["series"]) == 31
    assert body["series"][0]["projectedBalance"] == 1000.0


def test_cashflow_forecast_excludes_recurring_linked_transactions_from_variable_leg(client, db):
    account = Account(
        id=uuid4(),
        user_id="u1",
        name="Checking",
        account_type="checking",
        currency="EUR",
        functional_balance=Decimal("0"),
        is_active=True,
    )
    recurring = RecurringTransaction(
        id=uuid4(),
        user_id="u1",
        account_id=account.id,
        name="Netflix",
        amount=Decimal("15"),
        frequency="monthly",
        is_active=True,
        next_due_date=date.today() + timedelta(days=60),
    )
    db.add(account)
    db.add(recurring)
    db.commit()

    # A materialized recurring transaction: must not also be counted in the
    # trailing variable-spend average, or it would be double-counted.
    db.add(
        Transaction(
            id=uuid4(),
            user_id="u1",
            account_id=account.id,
            transaction_type="debit",
            amount=Decimal("-15"),
            functional_amount=Decimal("-15"),
            include_in_analytics=True,
            recurring_transaction_id=recurring.id,
            booked_at=datetime.utcnow() - timedelta(days=1),
        )
    )
    db.commit()

    r = client.get("/api/forecast/cashflow?horizon_days=1")
    assert r.status_code == 200, r.text
    body = r.json()
    # No non-recurring-linked transactions and horizon too short to hit the
    # recurring occurrence at day 60, so balance should stay flat at 0.
    assert body["projectedBalanceAtHorizon"] == 0.0
