"""Smoke tests for the OAuth 2.0 Protected Resource Metadata endpoint."""

import sys
from pathlib import Path

import pytest
from starlette.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# mcp_server.app is the ASGI app exposed by mcp.http_app()
from mcp_server import app  # noqa: E402


@pytest.fixture
def client():
    return TestClient(app)


def test_protected_resource_metadata_exposed(client):
    # RFC 9728 resource-scoped metadata: served under the protected
    # resource's own path (/mcp), not the bare .well-known root.
    resp = client.get("/.well-known/oauth-protected-resource/mcp")
    assert resp.status_code == 200
    body = resp.json()
    assert "authorization_servers" in body
    servers = body["authorization_servers"]
    # Self-hosted default: the authorization server is derived from this
    # deployment's own APP_URL (localhost:8080 unless overridden), not
    # upstream's app.syllogic.ai -- see AS_ISSUER in app/mcp/auth.py.
    assert any("localhost:8080" in str(s) for s in servers), body
    assert not any("app.syllogic.ai" in str(s) for s in servers), body


def test_unauthenticated_request_returns_401_with_www_authenticate(client):
    resp = client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    assert resp.status_code == 401
    www_auth = resp.headers.get("www-authenticate", "")
    assert "Bearer" in www_auth
    assert "resource_metadata" in www_auth
