"""Tests for which address the IP rate limiter throttles on.

The limiter's whole value is that one abusive source can't drown the others.
Behind a reverse proxy the TCP peer is the proxy, so without X-Forwarded-For
every remote caller shares one bucket -- but X-Forwarded-For is written by
the caller, so believing it unconditionally hands anyone a way to spread
their guessing across as many buckets as they like. These tests pin down the
narrow middle: trust the header only from a configured proxy, and only as
far as the rightmost hop that proxy didn't inherit.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest

from app.rate_limit import (
    IPRateLimitMiddleware,
    _parse_networks,
    client_address,
)


PROXY = _parse_networks("10.0.0.1, 172.16.0.0/12")


def _scope(peer: str, *forwarded: str, path: str = "/mcp"):
    headers = [(b"x-forwarded-for", value.encode()) for value in forwarded]
    return {
        "type": "http",
        "path": path,
        "client": (peer, 54321),
        "headers": headers,
    }


class TestClientAddress:
    def test_untrusted_peer_header_is_ignored(self):
        scope = _scope("203.0.113.9", "198.51.100.7")
        assert client_address(scope, PROXY) == "203.0.113.9"

    def test_no_trusted_proxies_configured_means_no_header_is_believed(self):
        scope = _scope("10.0.0.1", "198.51.100.7")
        assert client_address(scope, ()) == "10.0.0.1"

    def test_trusted_peer_yields_the_forwarded_client(self):
        scope = _scope("10.0.0.1", "198.51.100.7")
        assert client_address(scope, PROXY) == "198.51.100.7"

    def test_cidr_entry_matches(self):
        scope = _scope("172.18.0.5", "198.51.100.7")
        assert client_address(scope, PROXY) == "198.51.100.7"

    def test_forged_prefix_is_not_believed(self):
        # The proxy appends the address it actually saw, so only the
        # rightmost hop is trustworthy; everything left of it is whatever
        # the client chose to send.
        scope = _scope("10.0.0.1", "9.9.9.9, 198.51.100.7")
        assert client_address(scope, PROXY) == "198.51.100.7"

    def test_rightmost_untrusted_hop_wins_across_a_proxy_chain(self):
        scope = _scope("10.0.0.1", "198.51.100.7, 172.16.4.4")
        assert client_address(scope, PROXY) == "198.51.100.7"

    def test_several_forwarded_headers_are_joined_in_order(self):
        scope = _scope("10.0.0.1", "9.9.9.9", "198.51.100.7")
        assert client_address(scope, PROXY) == "198.51.100.7"

    def test_garbage_in_the_chain_falls_back_to_the_peer(self):
        scope = _scope("10.0.0.1", "198.51.100.7, notanip")
        assert client_address(scope, PROXY) == "10.0.0.1"

    def test_all_hops_trusted_falls_back_to_the_peer(self):
        scope = _scope("10.0.0.1", "172.16.0.9, 10.0.0.1")
        assert client_address(scope, PROXY) == "10.0.0.1"

    def test_missing_client_is_handled(self):
        scope = {"type": "http", "path": "/mcp", "client": None, "headers": []}
        assert client_address(scope, PROXY) == "unknown"

    def test_ipv6_peer_and_hop(self):
        trusted = _parse_networks("2001:db8::/32")
        scope = _scope("2001:db8::1", "2001:db8:ffff::9, 2001:db8::2")
        # Both hops sit inside the trusted range, so neither is the client.
        assert client_address(scope, trusted) == "2001:db8::1"


class TestParseNetworks:
    def test_blank_and_unparseable_entries_are_dropped(self):
        networks = _parse_networks(" 10.0.0.1 , , nonsense , 192.168.0.0/16 ")
        assert len(networks) == 2

    def test_none_yields_nothing(self):
        assert _parse_networks(None) == ()


class TestMiddlewareKeying:
    """The address must actually reach the counter key."""

    @pytest.mark.anyio
    async def test_distinct_forwarded_clients_get_distinct_buckets(self):
        seen: list[str] = []

        async def app(scope, receive, send):
            return None

        middleware = IPRateLimitMiddleware(app, trusted_proxies=PROXY)

        def _record(key, max_requests, window_seconds):
            seen.append(key)
            return False

        with patch("app.rate_limit.is_rate_limited", _record):
            await middleware(_scope("10.0.0.1", "198.51.100.7"), None, None)
            await middleware(_scope("10.0.0.1", "198.51.100.8"), None, None)

        assert seen == ["mcp-ip:198.51.100.7", "mcp-ip:198.51.100.8"]

    @pytest.mark.anyio
    async def test_health_is_still_exempt(self):
        calls: list[str] = []

        async def app(scope, receive, send):
            calls.append("through")

        middleware = IPRateLimitMiddleware(app, trusted_proxies=PROXY)
        with patch("app.rate_limit.is_rate_limited", side_effect=AssertionError):
            await middleware(_scope("10.0.0.1", path="/health"), None, None)

        assert calls == ["through"]


@pytest.fixture
def anyio_backend():
    return "asyncio"
