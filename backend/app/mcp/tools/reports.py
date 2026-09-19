"""Report (scheduled newsletter) tools for the MCP server.

Failures raise ToolError; a returned value means the write happened.
get_db() does not auto-rollback on exception, so every mutation path here
still rolls back explicitly before raising.

report_service raises four exception types and they are not
interchangeable. Validation and quota messages are the service's own prose
and go back to the caller as written -- they say what to change. Dispatch
failures do not: `ReportDispatchError` interpolates the broker exception,
and a Redis connection error renders as its URL, password included.
"""

from __future__ import annotations

from contextlib import contextmanager

from app.mcp.dependencies import get_db
from app.mcp.errors import not_found, raise_database_error, raise_dispatch_error
from app.mcp.tools._writes import preview_session, remember, replay
from app.services import report_service
from app.services.report_data_service import render_subject
from app.services.report_service import (
    ReportDispatchError,
    ReportNotFoundError,
    ReportQuotaExceededError,
    ReportValidationError,
)
from fastmcp.exceptions import ToolError


def _serialize_report(report) -> dict:
    return {
        "id": str(report.id),
        "name": report.name,
        "account_ids": list(report.account_ids or []),
        "transaction_mode": report.transaction_mode,
        "transaction_count": report.transaction_count,
        "transaction_direction": report.transaction_direction,
        "frequency": report.frequency,
        "send_time": report.send_time.isoformat() if report.send_time else None,
        "send_day_of_week": report.send_day_of_week,
        "send_day_of_month": report.send_day_of_month,
        "timezone": report.timezone,
        "recipient_emails": list(report.recipient_emails or []),
        "is_active": report.is_active,
        "next_run_at": report.next_run_at.isoformat() if report.next_run_at else None,
        "created_at": report.created_at.isoformat() if report.created_at else None,
        "updated_at": report.updated_at.isoformat() if report.updated_at else None,
    }


def _serialize_run(run) -> dict:
    return {
        "id": str(run.id),
        "report_id": str(run.report_id),
        "scheduled_for": run.scheduled_for.isoformat() if run.scheduled_for else None,
        "is_test": run.is_test,
        "started_at": run.started_at.isoformat() if run.started_at else None,
        "finished_at": run.finished_at.isoformat() if run.finished_at else None,
        "status": run.status,
        "error_message": run.error_message,
        "recipient_emails": list(run.recipient_emails or []),
        "created_at": run.created_at.isoformat() if run.created_at else None,
    }


def _remember(user_id: str, tool: str, key: str | None, digest: str | None, response: dict):
    """Store the response against its key, after the write it describes.

    Its own session: on a real call the write's session has already closed,
    and on a previewed one it was never going to be committed. Deliberately
    after the write -- if this fails, the write still stands and a retry just
    writes again, which is what no key at all would have done.
    """
    if not key or digest is None:
        return
    with get_db() as db:
        remember(db, user_id, tool, key, digest, response)


@contextmanager
def _session(dry_run: bool):
    """A normal session, or one whose writes are undone on exit.

    report_service commits internally, so a preview cannot be built by
    holding back the commit -- the write has already landed by the time
    control returns. The preview session rolls back the transaction the
    service committed into instead, which keeps the service path identical
    between a real call and a previewed one.
    """
    if dry_run:
        with preview_session() as db:
            yield db
    else:
        with get_db() as db:
            yield db


def _report_candidates(db, user_id: str) -> list[tuple[str, str]]:
    """(name, id) pairs for a not_found message, from the caller's session."""
    return [(r.name, str(r.id)) for r in report_service.list_reports(db, user_id)]


def list_reports(user_id: str) -> list[dict]:
    with get_db() as db:
        return [_serialize_report(r) for r in report_service.list_reports(db, user_id)]


def get_report(user_id: str, report_id: str) -> dict | None:
    with get_db() as db:
        try:
            return _serialize_report(report_service.get_report(db, user_id, report_id))
        except ReportNotFoundError:
            return None


def create_report(
    user_id: str,
    name: str,
    frequency: str,
    recipient_emails: list[str],
    account_ids: list[str] | None = None,
    transaction_mode: str = "RECENT",
    transaction_count: int = 10,
    transaction_direction: str = "ALL",
    send_time: str = "08:00:00",
    send_day_of_week: int | None = None,
    send_day_of_month: int | None = None,
    timezone: str = "UTC",
    is_active: bool = True,
    dry_run: bool = False,
    idempotency_key: str | None = None,
) -> dict:
    payload = {
        "name": name,
        "frequency": frequency,
        "recipient_emails": recipient_emails,
        "account_ids": account_ids or [],
        "transaction_mode": transaction_mode,
        "transaction_count": transaction_count,
        "transaction_direction": transaction_direction,
        "send_time": send_time,
        "send_day_of_week": send_day_of_week,
        "send_day_of_month": send_day_of_month,
        "timezone": timezone,
        "is_active": is_active,
    }
    with _session(dry_run) as db:
        # Checked before the write, so a replay never reaches the service.
        # A dry run takes no key: it is a question, not a call to remember.
        stored, digest = replay(
            db, user_id, "create_report", None if dry_run else idempotency_key, payload
        )
        if stored is not None:
            return stored

        try:
            report = report_service.create_report(db, user_id, payload)
            response = {
                "report": _serialize_report(report),
                "dry_run": dry_run,
                "committed": not dry_run,
            }
        except ReportValidationError as e:
            db.rollback()
            raise ToolError(str(e)) from None
        except Exception as e:  # noqa: BLE001
            db.rollback()
            raise_database_error("create_report", e)

    if not dry_run:
        _remember(user_id, "create_report", idempotency_key, digest, response)
    return response


def update_report(
    user_id: str,
    report_id: str,
    name: str | None = None,
    account_ids: list[str] | None = None,
    transaction_mode: str | None = None,
    transaction_count: int | None = None,
    transaction_direction: str | None = None,
    frequency: str | None = None,
    send_time: str | None = None,
    send_day_of_week: int | None = None,
    send_day_of_month: int | None = None,
    timezone: str | None = None,
    recipient_emails: list[str] | None = None,
    is_active: bool | None = None,
    dry_run: bool = False,
    idempotency_key: str | None = None,
) -> dict:
    # Only include explicitly-provided (non-None) fields, so omission
    # preserves the existing value (PATCH semantics) rather than nulling
    # it out. Fields that are legitimately settable to a falsy-but-valid
    # value (is_active=False) are still passed through explicitly by the
    # caller providing that exact value, not omitted.
    payload = {
        k: v
        for k, v in {
            "name": name,
            "account_ids": account_ids,
            "transaction_mode": transaction_mode,
            "transaction_count": transaction_count,
            "transaction_direction": transaction_direction,
            "frequency": frequency,
            "send_time": send_time,
            "send_day_of_week": send_day_of_week,
            "send_day_of_month": send_day_of_month,
            "timezone": timezone,
            "recipient_emails": recipient_emails,
            "is_active": is_active,
        }.items()
        if v is not None
    }
    with _session(dry_run) as db:
        stored, digest = replay(
            db,
            user_id,
            "update_report",
            None if dry_run else idempotency_key,
            {"report_id": report_id, **payload},
        )
        if stored is not None:
            return stored

        try:
            before = _serialize_report(report_service.get_report(db, user_id, report_id))
            report = report_service.update_report(db, user_id, report_id, payload)
            after = _serialize_report(report)
            response = {
                "changed": before != after,
                "before": before,
                "after": after,
                "fields_changed": [k for k in after if before.get(k) != after[k]],
                "report": after,
                "dry_run": dry_run,
                "committed": not dry_run,
            }
        except ReportNotFoundError:
            db.rollback()
            raise not_found(
                "report",
                report_id,
                candidates=_report_candidates(db, user_id),
                tool="list_reports",
            ) from None
        except ReportValidationError as e:
            db.rollback()
            raise ToolError(str(e)) from None
        except Exception as e:  # noqa: BLE001
            db.rollback()
            raise_database_error("update_report", e)

    if not dry_run:
        _remember(user_id, "update_report", idempotency_key, digest, response)
    return response


def delete_report(user_id: str, report_id: str, dry_run: bool = False) -> dict:
    with _session(dry_run) as db:
        try:
            # Snapshotted before the delete, so a dry run answers the only
            # question worth asking before destroying something: what is it.
            deleted = _serialize_report(report_service.get_report(db, user_id, report_id))
            run_count = len(report_service.list_report_runs(db, user_id, report_id))
            report_service.delete_report(db, user_id, report_id)
            return {
                "deleted_report_id": report_id,
                "deleted_report": deleted,
                "deleted_run_count": run_count,
                "dry_run": dry_run,
                "committed": not dry_run,
            }
        except ReportNotFoundError:
            db.rollback()
            raise not_found(
                "report",
                report_id,
                candidates=_report_candidates(db, user_id),
                tool="list_reports",
            ) from None
        except Exception as e:  # noqa: BLE001
            db.rollback()
            raise_database_error("delete_report", e)


def send_test_report(user_id: str, report_id: str, dry_run: bool = False) -> dict:
    with get_db() as db:
        try:
            if dry_run:
                # Not previewed through a rolled-back session like the other
                # writes: this one's effect is an email leaving the building,
                # and a transaction rollback does not un-send it. The dry run
                # answers what it can without touching the queue -- who it
                # would reach, what they would see in their inbox, and
                # whether the quota would even allow it.
                report = report_service.get_report(db, user_id, report_id)
                return {
                    "dry_run": True,
                    "committed": False,
                    "would_send_to": list(report.recipient_emails or []),
                    "subject": render_subject(report),
                    "quota_remaining": report_service.test_send_quota_remaining(db, user_id),
                }

            run = report_service.send_test_report(db, user_id, report_id)
            return {"run": _serialize_run(run), "dry_run": False, "committed": True}
        except ReportNotFoundError:
            db.rollback()
            raise not_found(
                "report",
                report_id,
                candidates=_report_candidates(db, user_id),
                tool="list_reports",
            ) from None
        except ReportQuotaExceededError as e:
            # The service's own message names the limit and says to retry.
            # Previously this fell through to the catch-all and came back as
            # a database error, which is both wrong and unactionable.
            db.rollback()
            raise ToolError(str(e)) from None
        except ReportDispatchError as e:
            # Not str(e): the broker exception is interpolated into this
            # message and a Redis URL carries its password.
            db.rollback()
            raise_dispatch_error("send_test_report", e)
        except Exception as e:  # noqa: BLE001
            db.rollback()
            raise_database_error("send_test_report", e)


def list_report_runs(user_id: str, report_id: str) -> list[dict]:
    with get_db() as db:
        try:
            return [
                _serialize_run(r) for r in report_service.list_report_runs(db, user_id, report_id)
            ]
        except ReportNotFoundError:
            return []
