"""Process-wide logging setup with a runtime-adjustable level.

Effective level resolves in priority order: database override (set from the
Settings UI, shared with the frontend via the same app_settings row) > the
LOG_LEVEL env var > INFO. gunicorn runs several worker processes
(WEB_CONCURRENCY), so each worker re-checks the database at most once every
REFRESH_INTERVAL_SECONDS from request middleware — cheap enough to call on
every request, but still lets a UI change reach every worker without a
restart.
"""

import json
import logging
import os
import time


_LEVEL_TO_PYTHON = {
    "debug": logging.DEBUG,
    "info": logging.INFO,
    "warn": logging.WARNING,
    "error": logging.ERROR,
}

REFRESH_INTERVAL_SECONDS = 10
# Force the first refresh_log_level_from_db() call to always run.
_last_checked_monotonic = float("-inf")


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "time": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(payload)


def _resolve_level(level_name: str) -> int:
    return _LEVEL_TO_PYTHON.get((level_name or "").strip().lower(), logging.INFO)


def configure_logging() -> None:
    """Install the root logger's handler/formatter. Call once at startup."""
    root = logging.getLogger()
    for handler in list(root.handlers):
        root.removeHandler(handler)

    handler = logging.StreamHandler()
    if (os.getenv("LOG_FORMAT") or "").strip().lower() == "json":
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(
            logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")
        )
    root.addHandler(handler)
    root.setLevel(_resolve_level(os.getenv("LOG_LEVEL", "info")))


def apply_log_level(level_name: str) -> None:
    logging.getLogger().setLevel(_resolve_level(level_name))


def refresh_log_level_from_db(session_factory) -> None:
    """Re-apply the effective log level, throttled to once per interval."""
    global _last_checked_monotonic

    now = time.monotonic()
    if now - _last_checked_monotonic < REFRESH_INTERVAL_SECONDS:
        return
    _last_checked_monotonic = now

    # Local import: app.services.app_settings imports app.models, which would
    # otherwise create a circular import at module load time (main.py imports
    # this module before the rest of the app package is fully initialized).
    from app.services.app_settings import get_effective_log_level

    db = session_factory()
    try:
        level = get_effective_log_level(db)
    finally:
        db.close()
    apply_log_level(level)
