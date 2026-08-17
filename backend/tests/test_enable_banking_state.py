from types import SimpleNamespace

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
