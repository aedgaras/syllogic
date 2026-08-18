"""Computes the next due date for a recurring transaction.

Unlike report scheduling (`report_schedule_service.py`), recurring
transactions are date-only (no time-of-day/timezone) — a transaction is due
on a calendar date, materialized whenever the next `check_due_recurring_transactions`
beat tick runs on or after that date.
"""

from __future__ import annotations

import calendar
from datetime import date, timedelta

_STEP_DAYS = {
    "weekly": 7,
    "biweekly": 14,
}
_STEP_MONTHS = {
    "monthly": 1,
    "quarterly": 3,
    "yearly": 12,
}


def compute_next_due_date(frequency: str, after: date) -> date:
    """Return the next due date strictly after `after` for `frequency`."""
    if frequency in _STEP_DAYS:
        return after + timedelta(days=_STEP_DAYS[frequency])
    if frequency in _STEP_MONTHS:
        return _add_months(after, _STEP_MONTHS[frequency])
    raise ValueError(f"Unknown frequency: {frequency}")


def _add_months(d: date, months: int) -> date:
    month_index = d.month - 1 + months
    year = d.year + month_index // 12
    month = month_index % 12 + 1
    day = min(d.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)
