"""
Pre-compute idle cash to ground the investment-plan agent before its loop
starts.
"""

from __future__ import annotations

from app.database import SessionLocal
from app.models import Account, Holding
from app.mcp.tools.investments import INVESTMENT_ACCOUNT_TYPES


def collect_grounding(user_id: str, days: int = 30) -> dict[str, list[dict]]:
    """
    Returns:
        {
            "cashSnapshot": [{ accountId, accountName, idleCash, currency }, ...],
            "recentActivity": []
        }

    Idle cash = balance_available − Σ(holding qty × avg_cost), clamped to 0.
    Manual holdings have no trade-import data source, so `recentActivity` is
    always empty; the `days` parameter and key are kept for API stability.
    """
    db = SessionLocal()
    try:
        accts = (
            db.query(Account)
            .filter(Account.user_id == user_id, Account.is_active.is_(True))
            .filter(Account.account_type.in_(INVESTMENT_ACCOUNT_TYPES))
            .all()
        )
        cash_snapshot: list[dict] = []
        for a in accts:
            if a.balance_available is not None:
                balance = float(a.balance_available)
            elif a.functional_balance is not None:
                balance = float(a.functional_balance)
            else:
                balance = 0.0
            holdings = db.query(Holding).filter(Holding.account_id == a.id).all()
            held_value = 0.0
            for h in holdings:
                qty = float(h.quantity or 0)
                avg = float(h.avg_cost or 0)
                held_value += qty * avg
            idle = max(0.0, balance - held_value)
            cash_snapshot.append(
                {
                    "accountId": str(a.id),
                    "accountName": a.name,
                    "idleCash": round(idle, 2),
                    "currency": a.currency or "EUR",
                }
            )

        return {"cashSnapshot": cash_snapshot, "recentActivity": []}
    finally:
        db.close()
