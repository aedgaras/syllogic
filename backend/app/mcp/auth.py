"""
API Key authentication for the MCP server.
Validates API keys and resolves them to user IDs.
"""

from __future__ import annotations

import hashlib
import logging
import os
import threading
import time
import bcrypt
from collections import OrderedDict
from datetime import datetime, timezone
from dataclasses import dataclass
from typing import Optional
from uuid import UUID

try:
    from fastmcp.server.auth import AuthProvider, AccessToken
except ImportError:  # pragma: no cover - fallback for environments without FastMCP

    class AuthProvider:  # type: ignore[override]
        pass

    @dataclass
    class AccessToken:  # type: ignore[override]
        token: str
        client_id: str
        scopes: list[str]
        expires_at: Optional[datetime]
        claims: dict[str, str]


from sqlalchemy import text

from app.database import SessionLocal, engine
from app.models import ApiKey

logger = logging.getLogger(__name__)


def _bounded_env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        value = default
    return max(minimum, min(maximum, value))


# ---------------------------------------------------------------------------
# Verified-key cache
#
# Every MCP request presents a bearer token, and verifying a bcrypt hash costs
# ~200ms of CPU. Without a cache, a single agent session (dozens of tool calls)
# spends seconds in bcrypt alone and writes `last_used_at` on every call.
#
# The cache stores the *outcome* of verification keyed by SHA-256 of the raw
# key, never the raw key itself. Consequences to keep in mind:
#   - The cache holds the outcome of the *bcrypt comparison*, not the
#     authorization decision: a cached hit still re-reads the row to confirm
#     the key has not been revoked, so deleting a key takes effect on the
#     next call. That re-read is one primary-key lookup -- roughly a
#     thousandth of the cost of bcrypt -- and can be throttled with
#     MCP_API_KEY_REVOCATION_CHECK_INTERVAL, which reintroduces exactly as
#     much revocation lag as it saves queries.
#   - `expires_at` is stored alongside and re-checked on every hit, so a key
#     that lapses mid-TTL is still rejected without touching the database.
#   - Negative results are cached too, so repeatedly presenting a bogus key
#     whose prefix happens to exist can't be used to burn CPU on bcrypt. The
#     map is bounded, so churning it only degrades to the uncached behaviour.
# ---------------------------------------------------------------------------

_CACHE_TTL_SECONDS = _bounded_env_int("MCP_API_KEY_CACHE_TTL", 60, 0, 3600)
_NEGATIVE_CACHE_TTL_SECONDS = min(30, _CACHE_TTL_SECONDS)
_CACHE_MAX_ENTRIES = 512
# `last_used_at` is an audit convenience, not something callers read back
# synchronously, so one write per interval per key is plenty.
_LAST_USED_MIN_INTERVAL_SECONDS = _bounded_env_int("MCP_API_KEY_LAST_USED_INTERVAL", 60, 0, 3600)

# 0 means "confirm the key still exists on every request", which is the
# default: a key the user revoked should stop working immediately, and the
# lookup is cheap enough that the cache still earns its keep by skipping
# bcrypt. Raising this buys one fewer query per call at the price of a
# revoked key remaining usable for that many seconds.
_REVOCATION_CHECK_INTERVAL_SECONDS = _bounded_env_int(
    "MCP_API_KEY_REVOCATION_CHECK_INTERVAL", 0, 0, 3600
)

_TOUCH_LAST_USED_SQL = text("UPDATE api_keys SET last_used_at = :now WHERE id = :id")
_KEY_LIVENESS_SQL = text("SELECT expires_at FROM api_keys WHERE id = :id")


@dataclass
class _CachedKey:
    """One verification outcome. `user_id is None` means 'known bad key'."""

    user_id: Optional[str]
    key_id: Optional[UUID]
    expires_at: Optional[datetime]
    cached_at: float  # time.monotonic()
    last_used_written_at: float  # time.monotonic()
    # Defaults to 0.0 so an entry that predates a liveness check is always
    # re-checked rather than trusted.
    liveness_checked_at: float = 0.0  # time.monotonic()

    def is_stale(self, now: float) -> bool:
        ttl = _CACHE_TTL_SECONDS if self.user_id else _NEGATIVE_CACHE_TTL_SECONDS
        return (now - self.cached_at) >= ttl


_cache: "OrderedDict[str, _CachedKey]" = OrderedDict()
_cache_lock = threading.Lock()


def _cache_digest(api_key: str) -> str:
    return hashlib.sha256(api_key.encode()).hexdigest()


def _cache_get(digest: str) -> Optional[_CachedKey]:
    now = time.monotonic()
    with _cache_lock:
        entry = _cache.get(digest)
        if entry is None:
            return None
        if entry.is_stale(now):
            del _cache[digest]
            return None
        _cache.move_to_end(digest)
        return entry


def _cache_put(digest: str, entry: _CachedKey) -> None:
    if _CACHE_TTL_SECONDS <= 0:
        return
    with _cache_lock:
        _cache[digest] = entry
        _cache.move_to_end(digest)
        while len(_cache) > _CACHE_MAX_ENTRIES:
            _cache.popitem(last=False)


def _cache_evict(digest: str) -> None:
    with _cache_lock:
        _cache.pop(digest, None)


def invalidate_api_key_cache(api_key: Optional[str] = None) -> None:
    """
    Drop cached verification results.

    Call with an api_key to forget one key (e.g. on revocation), or with no
    argument to clear the whole cache. Tests rely on the no-argument form to
    keep cases independent.
    """
    if api_key is None:
        with _cache_lock:
            _cache.clear()
        return
    _cache_evict(_cache_digest(api_key))


def _is_expired(expires_at: Optional[datetime], now: Optional[datetime] = None) -> bool:
    if expires_at is None:
        return False
    # Naive timestamps can come back from drivers/tests that drop tzinfo;
    # treat them as UTC rather than raising on the comparison.
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    return expires_at < (now or datetime.now(timezone.utc))


def _key_fingerprint(digest: str) -> str:
    """A stable, non-reversible handle on a rejected credential.

    The first hex chars of its SHA-256, never the key or its `pf_` prefix --
    the prefix is eight characters of the real secret and has no business in
    a log file. Repeated failures from one bad credential are still countable
    because the fingerprint is stable.
    """
    return digest[:12]


def _log_auth_failure(reason: str, digest: Optional[str] = None) -> None:
    """One line per rejected credential.

    Rejections used to be invisible: ToolCallLogger only sees calls that have
    already authenticated, so a key-guessing run left no trace anywhere. A
    burst of `reason=unknown_key` with varying fingerprints is guessing; a
    run with one fingerprint is a stale client.
    """
    logger.warning(
        "mcp auth outcome=denied reason=%s key_fp=%s",
        reason,
        _key_fingerprint(digest) if digest else "-",
    )


def _key_liveness_failure(entry: _CachedKey) -> Optional[str]:
    """Confirm a cached key still exists; returns None when it does.

    Also refreshes `expires_at`, so shortening a key's expiry takes effect on
    the next call rather than at the end of the cache TTL.

    A failed lookup denies the request. Every MCP tool needs this same
    database, so denying costs no availability that was not already lost,
    and failing open would mean revoked keys start working again precisely
    when the audit trail is broken.
    """
    if entry.key_id is None:
        return "revoked"

    now = time.monotonic()
    if (
        _REVOCATION_CHECK_INTERVAL_SECONDS
        and (now - entry.liveness_checked_at) < _REVOCATION_CHECK_INTERVAL_SECONDS
    ):
        return None

    try:
        with engine.connect() as conn:
            row = conn.execute(_KEY_LIVENESS_SQL, {"id": entry.key_id}).first()
    except Exception:
        logger.warning(
            "Could not confirm the API key still exists; denying the request.",
            exc_info=True,
        )
        return "liveness_lookup_failed"

    if row is None:
        return "revoked"

    entry.expires_at = row[0]
    entry.liveness_checked_at = now
    return None


def _touch_last_used(entry: _CachedKey) -> None:
    """Refresh `last_used_at`, at most once per interval per key."""
    if entry.key_id is None:
        return
    now = time.monotonic()
    if (now - entry.last_used_written_at) < _LAST_USED_MIN_INTERVAL_SECONDS:
        return
    # Stamp before the write so a failing database doesn't turn into a retry
    # storm on every subsequent request.
    entry.last_used_written_at = now
    try:
        with engine.begin() as conn:
            conn.execute(
                _TOUCH_LAST_USED_SQL,
                {"now": datetime.now(timezone.utc), "id": entry.key_id},
            )
    except Exception:
        # Bookkeeping only -- never fail authentication over it.
        logger.warning("Could not update api_keys.last_used_at.", exc_info=True)


def hash_api_key(key: str) -> str:
    """
    Hash an API key using bcrypt with salt.

    For new keys, use this function to generate the hash to store.
    """
    return bcrypt.hashpw(key.encode(), bcrypt.gensalt()).decode()


def verify_api_key(key: str, stored_hash: str) -> bool:
    """
    Verify an API key against its stored hash.

    Handles both bcrypt hashes (new) and SHA-256 hashes (legacy).
    """
    # Check if it's a bcrypt hash (starts with $2b$ or $2a$)
    if stored_hash.startswith("$2"):
        return bcrypt.checkpw(key.encode(), stored_hash.encode())

    # Legacy SHA-256 hash (64 hex characters)
    legacy_hash = hashlib.sha256(key.encode()).hexdigest()
    return legacy_hash == stored_hash


def validate_api_key(api_key: str) -> Optional[str]:
    """
    Validate an API key and return the associated user_id.

    Supports both bcrypt (new) and SHA-256 (legacy) hashed keys.
    Legacy keys are automatically migrated to bcrypt on first use.

    The bcrypt comparison is cached for MCP_API_KEY_CACHE_TTL seconds
    (default 60), but every call still confirms the key has not been revoked;
    see the cache notes above.

    Args:
        api_key: The raw API key string (e.g., "pf_abc123...")

    Returns:
        The user_id if the key is valid, None otherwise.
    """
    if not api_key or not api_key.startswith("pf_"):
        _log_auth_failure("malformed")
        return None

    digest = _cache_digest(api_key)
    cached = _cache_get(digest)
    if cached is not None:
        if cached.user_id is None:
            _log_auth_failure("unknown_key_cached", digest)
            return None
        failure = _key_liveness_failure(cached)
        if failure:
            _cache_evict(digest)
            _log_auth_failure(failure, digest)
            return None
        if _is_expired(cached.expires_at):
            _cache_evict(digest)
            _log_auth_failure("expired", digest)
            return None
        _touch_last_used(cached)
        return cached.user_id

    now_monotonic = time.monotonic()
    db = SessionLocal()
    try:
        # For bcrypt, we need to check all keys since we can't look up by hash
        # First try legacy SHA-256 lookup for backwards compatibility
        legacy_hash = digest
        record = db.query(ApiKey).filter(ApiKey.key_hash == legacy_hash).first()

        if record:
            # Found with legacy hash - migrate to bcrypt
            record.key_hash = hash_api_key(api_key)
            db.commit()
        else:
            # Try to find a bcrypt-hashed key, scoped by (indexed) key prefix.
            # The prefix lookup is authoritative: a miss here means the key
            # doesn't exist, full stop. Falling back to scanning every row
            # would mean an unrecognized key still costs one bcrypt
            # comparison per row in the table -- CPU exhaustion available to
            # anyone who can send a request with a bogus pf_ prefix.
            key_prefix = api_key[:11]  # "pf_" + 8 chars
            candidates = db.query(ApiKey).filter(ApiKey.key_prefix == key_prefix).all()
            for key_record in candidates:
                if verify_api_key(api_key, key_record.key_hash):
                    record = key_record
                    break

        if not record:
            _cache_put(
                digest,
                _CachedKey(
                    user_id=None,
                    key_id=None,
                    expires_at=None,
                    cached_at=now_monotonic,
                    last_used_written_at=now_monotonic,
                ),
            )
            _log_auth_failure("unknown_key", digest)
            return None

        # Check if expired. Not cached as a negative result: the key is real,
        # and caching "bad" under its digest would outlive an expiry extension.
        if _is_expired(record.expires_at):
            _log_auth_failure("expired", digest)
            return None

        # Update last_used_at timestamp
        record.last_used_at = datetime.now(timezone.utc)
        db.commit()

        _cache_put(
            digest,
            _CachedKey(
                user_id=record.user_id,
                key_id=record.id,
                expires_at=record.expires_at,
                cached_at=now_monotonic,
                last_used_written_at=now_monotonic,
                # Just read from the database, so it is live by definition.
                liveness_checked_at=now_monotonic,
            ),
        )

        return record.user_id
    finally:
        db.close()


class ApiKeyAuthProvider(AuthProvider):
    """
    FastMCP auth provider that validates API keys from Authorization headers.
    """

    async def verify_token(self, token: str) -> AccessToken | None:
        user_id = validate_api_key(token)
        if not user_id:
            return None
        # Use user_id as client_id; include it in claims for easy access.
        return AccessToken(
            token=token,
            client_id=user_id,
            scopes=["mcp"],
            expires_at=None,
            claims={"user_id": user_id},
        )


try:
    from fastmcp.server.auth.providers.jwt import JWTVerifier
except ImportError:  # pragma: no cover
    JWTVerifier = None  # type: ignore


# Self-hosted default: derive the authorization server from this deployment's
# own APP_URL rather than trusting a third-party host. A fork that never sets
# these must verify tokens against *its own* better-auth instance, not
# upstream's — otherwise any JWT the upstream project issues would be
# accepted here.
APP_URL = os.environ.get("APP_URL", "http://localhost:8080")
AS_ISSUER = os.environ.get("MCP_OAUTH_ISSUER") or f"{APP_URL}/api/auth"
AS_JWKS_URI = os.environ.get("MCP_OAUTH_JWKS_URI") or f"{AS_ISSUER}/jwks"
# Public server root (no path). RemoteAuthProvider uses this as base_url and
# appends the MCP route on top when advertising the Protected Resource.
# Keep it separate from MCP_AUDIENCE (which is the JWT `aud` claim value).
MCP_PUBLIC_URL = os.environ.get("MCP_PUBLIC_URL", "http://localhost:8001")
MCP_AUDIENCE = os.environ.get("MCP_OAUTH_AUDIENCE") or f"{MCP_PUBLIC_URL}/mcp"


class CompositeAuthProvider(AuthProvider):
    """
    Accepts either a pf_ API key (existing DB-backed) or a JWT issued by
    the Syllogic Authorization Server (better-auth on app.syllogic.ai).

    Prefix-gating: tokens starting with 'pf_' go to ApiKeyAuthProvider;
    everything else is treated as a JWT. This keeps the two paths fully
    disjoint.
    """

    # RemoteAuthProvider reads these off the wrapped token verifier when
    # computing its own required_scopes / scopes_supported; default to empty.
    required_scopes: list[str] = []
    scopes_supported: list[str] = []

    def __init__(self) -> None:
        if JWTVerifier is None:
            raise RuntimeError(
                "fastmcp.server.auth.providers.jwt.JWTVerifier is required "
                "for CompositeAuthProvider. Bump fastmcp."
            )
        self.api_key = ApiKeyAuthProvider()
        self.jwt = JWTVerifier(
            jwks_uri=AS_JWKS_URI,
            issuer=AS_ISSUER,
            audience=MCP_AUDIENCE,
        )

    async def verify_token(self, token: str) -> AccessToken | None:
        if not token:
            _log_auth_failure("empty_token")
            return None
        if token.startswith("pf_"):
            return await self.api_key.verify_token(token)
        try:
            access = await self.jwt.verify_token(token)
        except Exception:
            # A verifier that throws (unreachable JWKS, malformed token) is a
            # denial either way; log it with the traceback so a misconfigured
            # issuer is distinguishable from ordinary bad tokens.
            logger.warning("JWT verification raised; denying.", exc_info=True)
            _log_auth_failure("jwt_error")
            return None
        if access is None:
            _log_auth_failure("jwt_invalid")
            return None
        if "user_id" not in access.claims:
            sub = access.claims.get("sub")
            if not sub:
                _log_auth_failure("jwt_missing_subject")
                return None
            access.claims["user_id"] = sub
        return access
