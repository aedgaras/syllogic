"""Integration tests for the /api/receipt-scan endpoints."""

import hashlib
import hmac
import json
import time
from decimal import Decimal
from unittest.mock import patch
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.database import get_db
from app.main import app
from app.models import Account, Category, ReceiptScan, Transaction, User


INTERNAL_AUTH_SECRET = "test-internal-secret"

# 1x1 white pixel PNG, just needs to be bytes tesseract's call site receives -
# pytesseract.image_to_string itself is mocked out in these tests.
TINY_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


def _signed_headers(method: str, path_with_query: str, user_id: str = "u1", body: bytes = b"") -> dict:
    timestamp = str(int(time.time()))
    payload = "\n".join(
        [method.upper(), path_with_query, user_id, timestamp, hashlib.sha256(body).hexdigest()]
    )
    signature = hmac.new(
        INTERNAL_AUTH_SECRET.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256
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

    def post(self, url, **kw):
        return self.request("POST", url, **kw)


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    for model in (User, Account, Category, ReceiptScan, Transaction):
        model.__table__.create(bind=engine)
    with Session(engine) as session:
        yield session


@pytest.fixture
def client(db, monkeypatch):
    monkeypatch.setenv("INTERNAL_AUTH_SECRET", INTERNAL_AUTH_SECRET)
    db.add(User(id="u1", email="u@example.com", functional_currency="EUR"))
    db.commit()
    app.dependency_overrides[get_db] = lambda: db
    monkeypatch.setattr("app.routes.receipt_scan.get_user_id", lambda x=None: "u1")
    yield SigningClient(TestClient(app))
    app.dependency_overrides.clear()


@pytest.fixture
def account(db):
    acc = Account(id=uuid4(), user_id="u1", name="Checking", account_type="checking", currency="EUR")
    db.add(acc)
    db.commit()
    return acc


def _mock_ocr_text(monkeypatch, text: str):
    monkeypatch.setattr("app.services.receipt_ocr.pytesseract.image_to_string", lambda *a, **kw: text)


def test_extract_parses_and_categorizes_items(client, db, account, monkeypatch):
    _mock_ocr_text(
        monkeypatch,
        "Milk 2L                3.49\nBread Whole Wheat      2.99\nTotal                   6.48\n",
    )
    monkeypatch.setattr("app.services.receipt_ocr.create_llm_clients", lambda db: [])

    groceries = Category(id=uuid4(), user_id="u1", name="Groceries", category_type="expense")
    db.add(groceries)
    db.commit()

    with patch(
        "app.services.receipt_ocr.CategoryMatcher.match_category", return_value=groceries
    ):
        r = client.post(
            "/api/receipt-scan/extract",
            json={
                "account_id": str(account.id),
                "file_base64": TINY_PNG_B64,
                "content_type": "image/png",
            },
        )

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "processed"
    assert len(body["items"]) == 2
    assert body["items"][0]["description"] == "Milk 2L"
    assert body["items"][0]["category_id"] == str(groceries.id)
    assert body["items"][0]["category_name"] == "Groceries"

    scan = db.query(ReceiptScan).one()
    assert scan.status == "processed"
    assert scan.account_id == account.id


def test_extract_rejects_unknown_account(client):
    r = client.post(
        "/api/receipt-scan/extract",
        json={"account_id": str(uuid4()), "file_base64": TINY_PNG_B64},
    )
    assert r.status_code == 404


def test_extract_rejects_invalid_base64(client, account):
    r = client.post(
        "/api/receipt-scan/extract",
        json={"account_id": str(account.id), "file_base64": "not-base64!!"},
    )
    assert r.status_code == 400


def test_confirm_creates_one_transaction_per_item(client, db, account, monkeypatch):
    _mock_ocr_text(monkeypatch, "Milk 2L 3.49\n")
    monkeypatch.setattr("app.services.receipt_ocr.create_llm_clients", lambda db: [])

    with patch("app.services.receipt_ocr.CategoryMatcher.match_category", return_value=None):
        extract_resp = client.post(
            "/api/receipt-scan/extract",
            json={"account_id": str(account.id), "file_base64": TINY_PNG_B64},
        )
    receipt_scan_id = extract_resp.json()["receipt_scan_id"]

    r = client.post(
        f"/api/receipt-scan/{receipt_scan_id}/confirm",
        json={
            "items": [
                {"description": "Milk 2L", "amount": "3.49", "transaction_type": "debit"},
                {"description": "Bread", "amount": "2.99", "transaction_type": "debit"},
            ],
            "booked_at": "2026-08-18T10:00:00Z",
        },
    )

    assert r.status_code == 200, r.text
    transactions = r.json()
    assert len(transactions) == 2
    assert {t["description"] for t in transactions} == {"Milk 2L", "Bread"}
    assert {Decimal(str(t["amount"])) for t in transactions} == {Decimal("3.49"), Decimal("2.99")}

    db_transactions = (
        db.query(Transaction).filter(Transaction.receipt_scan_id == UUID(receipt_scan_id)).all()
    )
    assert len(db_transactions) == 2

    scan = db.query(ReceiptScan).filter(ReceiptScan.id == UUID(receipt_scan_id)).one()
    assert scan.status == "completed"
    assert scan.completed_at is not None


def test_confirm_rejects_unknown_receipt_scan(client):
    r = client.post(
        f"/api/receipt-scan/{uuid4()}/confirm",
        json={"items": [{"description": "x", "amount": "1.00"}], "booked_at": "2026-08-18T10:00:00Z"},
    )
    assert r.status_code == 404


def test_confirm_rejects_empty_items(client, db, account, monkeypatch):
    _mock_ocr_text(monkeypatch, "Milk 2L 3.49\n")
    monkeypatch.setattr("app.services.receipt_ocr.create_llm_clients", lambda db: [])

    with patch("app.services.receipt_ocr.CategoryMatcher.match_category", return_value=None):
        extract_resp = client.post(
            "/api/receipt-scan/extract",
            json={"account_id": str(account.id), "file_base64": TINY_PNG_B64},
        )
    receipt_scan_id = extract_resp.json()["receipt_scan_id"]

    r = client.post(
        f"/api/receipt-scan/{receipt_scan_id}/confirm",
        json={"items": [], "booked_at": "2026-08-18T10:00:00Z"},
    )
    assert r.status_code == 400
