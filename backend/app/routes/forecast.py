from datetime import date, timedelta
from decimal import Decimal
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.db_helpers import get_user_id
from app.models import Account, RecurringTransaction, Transaction
from app.services.forecast_service import RecurringDefinition, project_cash_flow

router = APIRouter()

# Window used to estimate the flat daily average for non-recurring
# ("variable") spend/income — long enough to smooth out a single noisy
# month, short enough to react to a real change in habits.
_TRAILING_HISTORY_DAYS = 90


@router.get("/cashflow")
def get_cashflow_forecast(
    horizon_days: int = Query(30, ge=1, le=365),
    account_ids: Optional[list[UUID]] = Query(None),
    user_id: str = Depends(get_user_id),
    db: Session = Depends(get_db),
):
    """Project daily account balance forward, plus a savings summary.

    Combines two legs: known future amounts from active recurring
    transactions, and a flat trailing-average for everything else. See
    app/services/forecast_service.py for the projection math.
    """
    accounts_query = db.query(Account).filter(Account.user_id == user_id, Account.is_active == True)
    if account_ids:
        accounts_query = accounts_query.filter(Account.id.in_(account_ids))
    accounts = accounts_query.all()
    account_id_list = [a.id for a in accounts]
    starting_balance = sum((a.functional_balance or Decimal("0")) for a in accounts) or Decimal("0")

    recurring_query = db.query(RecurringTransaction).filter(
        RecurringTransaction.user_id == user_id,
        RecurringTransaction.is_active == True,
        RecurringTransaction.next_due_date.isnot(None),
    )
    if account_ids:
        recurring_query = recurring_query.filter(
            RecurringTransaction.account_id.in_(account_id_list)
        )
    recurring = [
        RecurringDefinition(
            frequency=r.frequency,
            amount=r.amount,
            next_due_date=r.next_due_date,
            end_date=r.end_date,
        )
        for r in recurring_query.all()
    ]

    history_start = date.today() - timedelta(days=_TRAILING_HISTORY_DAYS)
    variable_query = db.query(func.sum(Transaction.functional_amount)).filter(
        Transaction.user_id == user_id,
        Transaction.include_in_analytics == True,
        Transaction.recurring_transaction_id.is_(None),
        Transaction.booked_at >= history_start,
    )
    if account_ids:
        variable_query = variable_query.filter(Transaction.account_id.in_(account_id_list))
    variable_net_total = variable_query.scalar() or Decimal("0")
    trailing_daily_net = Decimal(variable_net_total) / _TRAILING_HISTORY_DAYS

    result = project_cash_flow(
        starting_balance=starting_balance,
        recurring=recurring,
        trailing_daily_net=trailing_daily_net,
        horizon_days=horizon_days,
    )

    return {
        "startingBalance": float(result.starting_balance),
        "projectedBalanceAtHorizon": float(result.projected_balance_at_horizon),
        "projectedNetCashFlow": float(result.projected_net_cash_flow),
        "projectedIncome": float(result.projected_income),
        "projectedExpenses": float(result.projected_expenses),
        "series": [
            {"date": p.day.isoformat(), "projectedBalance": float(p.projected_balance)}
            for p in result.series
        ],
    }
