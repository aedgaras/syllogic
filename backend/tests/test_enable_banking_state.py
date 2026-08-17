import json
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from app.routes import enable_banking


class FakeRedis:
    def __init__(self, value=None):
        self.value = value
        self.consumed = False

    def getdel(self, _key):
        assert not self.consumed
        self.consumed = True
        return self.value


def test_unknown_oauth_state_is_rejected(monkeypatch):
    redis = FakeRedis()
    monkeypatch.setattr(enable_banking, "_get_redis", lambda: redis)
    with pytest.raises(HTTPException) as exc:
        enable_banking.create_session(
            enable_banking.SessionRequest(code="code", state="unknown"),
            user_id="user-1",
            db=None,
        )
    assert exc.value.status_code == 403
    assert redis.consumed


def test_oauth_state_store_failure_is_closed(monkeypatch):
    def unavailable():
        raise ConnectionError("redis unavailable")

    monkeypatch.setattr(enable_banking, "_get_redis", unavailable)
    monkeypatch.setattr(enable_banking, "_get_eb_client", lambda: SimpleNamespace())
    with pytest.raises(HTTPException) as exc:
        enable_banking.initiate_auth(
            enable_banking.AuthRequest(aspsp_name="Bank", aspsp_country="LT"),
            user_id="user-1",
            db=None,
        )
    assert exc.value.status_code == 503


def test_auth_state_metadata_round_trips_relink_connection():
    stored = json.dumps({"user_id": "user-1", "connection_id": "connection-1"})

    assert enable_banking._decode_auth_state(stored) == ("user-1", "connection-1")


def test_legacy_auth_state_still_decodes():
    assert enable_banking._decode_auth_state("user-1") == ("user-1", None)
    assert enable_banking._decode_auth_state('"user-1"') == ("user-1", None)


def test_create_session_relinks_existing_connection(monkeypatch):
    redis = FakeRedis(json.dumps({
        "user_id": "user-1",
        "connection_id": "connection-1",
    }))
    monkeypatch.setattr(enable_banking, "_get_redis", lambda: redis)

    session_data = {
        "session_id": "new-session",
        "aspsp": {"name": "Bank", "country": "LT"},
        "access": {"valid_until": "2026-11-15T12:00:00.000Z"},
        "accounts": [{"uid": "new-account-uid"}],
    }
    client = MagicMock()
    client.post.return_value.json.return_value = session_data
    monkeypatch.setattr(enable_banking, "_get_eb_client", lambda: client)
    monkeypatch.setattr(enable_banking, "_relink_accounts", lambda *_args: 1)

    connection = SimpleNamespace(
        id="connection-1",
        user_id="user-1",
        aspsp_name="Bank",
        aspsp_country="LT",
        session_id="old-session",
        consent_expires_at=None,
        consent_notified_at=object(),
        status="expired",
        last_sync_error="Consent expired",
        sync_started_at=None,
        raw_session_data=None,
    )
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = connection

    monkeypatch.setattr(
        "tasks.enable_banking_tasks.sync_bank_connection.delay",
        lambda *_args: None,
    )

    result = enable_banking.create_session(
        enable_banking.SessionRequest(code="code", state="state"),
        user_id="user-1",
        db=db,
    )

    assert result.connection_id == "connection-1"
    assert result.relinked is True
    assert result.accounts_count == 1
    assert connection.session_id == "new-session"
    assert connection.status == "active"
    assert connection.last_sync_error is None
    assert connection.consent_notified_at is None
    db.add.assert_not_called()
    db.commit.assert_called_once()
