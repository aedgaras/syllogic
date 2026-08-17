import hashlib
import hmac
import time

import pytest
from fastapi import HTTPException

from app.db_helpers import authenticate_internal_request_with_body


def _headers(secret: str, body: bytes) -> dict[str, str]:
    timestamp = str(int(time.time()))
    body_digest = hashlib.sha256(body).hexdigest()
    payload = "\n".join(["POST", "/api/example", "user-1", timestamp, body_digest])
    signature = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return {
        "x-syllogic-user-id": "user-1",
        "x-syllogic-timestamp": timestamp,
        "x-syllogic-signature": signature,
    }


def test_internal_signature_is_bound_to_exact_body(monkeypatch):
    secret = "test-secret"
    monkeypatch.setenv("INTERNAL_AUTH_SECRET", secret)
    signed_body = b'{"amount":1}'
    headers = _headers(secret, signed_body)

    assert (
        authenticate_internal_request_with_body("POST", "/api/example", headers, signed_body)
        == "user-1"
    )
    with pytest.raises(HTTPException) as exc:
        authenticate_internal_request_with_body("POST", "/api/example", headers, b'{"amount":999}')
    assert exc.value.status_code == 401
