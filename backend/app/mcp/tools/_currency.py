"""Currency helpers shared by the MCP tool modules.

Two separate concerns live here, and they are deliberately not the same
mechanism:

- `user_currency` / `convert` handle *scalar* conversion for values the
  database does not already store in the user's functional currency (a
  budget's limit, say). `convert` degrades to the unconverted amount when no
  rate is on record -- that is the web app's behaviour and changing it is a
  product decision, not a bug fix.

- `FUNCTIONAL_AMOUNT_SQL` handles *aggregate* conversion, and takes the
  opposite stance: a row that cannot be stated in the functional currency
  contributes NULL, so SUM skips it and the caller reports how many rows were
  skipped. Folding an unconverted USD row into a EUR total produces a wrong
  number that looks exactly like a right one, which is worse than a number
  the caller knows is incomplete.
"""

from __future__ import annotations

from sqlalchemy import case
from sqlalchemy.orm import Session

from app.models import ExchangeRate, Transaction, User


DEFAULT_CURRENCY = "EUR"


def user_currency(db: Session, user_id: str) -> str:
    """The currency this user's totals are reported in."""
    currency = db.query(User.functional_currency).filter(User.id == user_id).scalar()
    return currency or DEFAULT_CURRENCY


def convert(db: Session, amount: float, from_currency: str, to_currency: str) -> float:
    """Convert using the most recent rate, falling back to the inverse pair.

    With no rate on record the amount is returned unconverted rather than
    raising -- same fallback the web app uses, so a missing rate degrades a
    number instead of breaking the whole read.
    """
    if amount == 0 or from_currency == to_currency:
        return amount

    rate = (
        db.query(ExchangeRate.rate)
        .filter(
            ExchangeRate.base_currency == from_currency,
            ExchangeRate.target_currency == to_currency,
        )
        .order_by(ExchangeRate.date.desc())
        .first()
    )
    if rate:
        return amount * float(rate[0])

    inverse = (
        db.query(ExchangeRate.rate)
        .filter(
            ExchangeRate.base_currency == to_currency,
            ExchangeRate.target_currency == from_currency,
        )
        .order_by(ExchangeRate.date.desc())
        .first()
    )
    if inverse and float(inverse[0]) != 0:
        return amount / float(inverse[0])

    return amount


# A transaction's amount in the user's functional currency, or NULL when it
# cannot be stated in that currency.
#
# `functional_amount` is populated at import time, but only when a rate was
# available: both transaction_import and the recurring generator write NULL
# otherwise, so NULL is an ongoing state and not a legacy artifact. That rules
# out COALESCE(functional_amount, amount) -- it would fall back to the raw
# amount for exactly the foreign-currency rows that need converting, silently
# adding dollars to euros.
#
# Binds :functional_currency. Aliases the transactions table as `t`, matching
# the hand-written aggregate SQL in analytics.py.
FUNCTIONAL_AMOUNT_SQL = """
        CASE
            WHEN t.functional_amount IS NOT NULL THEN t.functional_amount
            WHEN t.currency = :functional_currency THEN t.amount
            ELSE NULL
        END"""


# Same expression for the ORM query paths (get_top_merchants), where there is
# no `t` alias to reference.
def functional_amount_expr(functional_currency: str):
    """ORM equivalent of `FUNCTIONAL_AMOUNT_SQL`."""
    return case(
        (Transaction.functional_amount.isnot(None), Transaction.functional_amount),
        (Transaction.currency == functional_currency, Transaction.amount),
        else_=None,
    )
