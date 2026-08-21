"""Per-request id, threaded from the proxy through this service's logs.

The id originates at Caddy (or is generated here if missing, e.g. when
calling the backend directly in dev) and is forwarded by the Next.js BFF
when it proxies to this service. Every log line emitted while handling a
request carries it via `RequestIdLogFilter`, and it's echoed back in the
`X-Request-Id` response header so it round-trips to the client that can
report it.
"""

from __future__ import annotations

import contextvars
import logging
import uuid

REQUEST_ID_HEADER = "x-request-id"

_request_id: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="-")


def new_request_id() -> str:
    return uuid.uuid4().hex


def set_request_id(value: str) -> contextvars.Token:
    return _request_id.set(value)


def clear_request_id(token: contextvars.Token) -> None:
    _request_id.reset(token)


def get_request_id() -> str:
    return _request_id.get()


class RequestIdLogFilter(logging.Filter):
    """Attaches the current request id to every log record as `request_id`,
    so JsonFormatter (and any other formatter that references it) can
    include it."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = get_request_id()
        return True
