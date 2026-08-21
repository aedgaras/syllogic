"""Opt-in error reporting: POSTs unhandled-exception details to a webhook
URL when ERROR_REPORTING_WEBHOOK_URL is set. No-op when it isn't -- this
app ships with no error tracking by default, and this is a low-effort way
to wire one up (a custom collector, an internal alerting endpoint, or
anything else that accepts a JSON POST) without pulling in an SDK.

Best-effort: a failure here must never affect the response already being
sent to the caller.
"""

from __future__ import annotations

import logging
import os
import traceback

import httpx

logger = logging.getLogger(__name__)


async def report_exception(exc: BaseException, *, path: str, method: str, request_id: str) -> None:
    webhook_url = os.environ.get("ERROR_REPORTING_WEBHOOK_URL")
    if not webhook_url:
        return

    payload = {
        "service": "syllogic-backend",
        "request_id": request_id,
        "method": method,
        "path": path,
        "exception_type": type(exc).__name__,
        "exception_message": str(exc),
        "traceback": "".join(traceback.format_exception(type(exc), exc, exc.__traceback__)),
    }
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(webhook_url, json=payload)
    except Exception:  # noqa: BLE001 - reporting failures must not propagate
        logger.warning("Failed to report exception to ERROR_REPORTING_WEBHOOK_URL", exc_info=True)
