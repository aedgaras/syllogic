from __future__ import annotations
from datetime import date, datetime, timezone
from uuid import UUID
import logging
from sqlalchemy.orm import Session

from app.models import (
    Account,
    Holding,
)
from app.services.holding_valuation_service import HoldingValuationService, FxConverter
from app.services.price_service import PriceService

logger = logging.getLogger(__name__)


class InvestmentSyncService:
    def __init__(
        self,
        db: Session,
        fx: FxConverter,
        price_service: PriceService | None = None,
        valuation_service: HoldingValuationService | None = None,
    ):
        self.db = db
        self.fx = fx
        self.price_service = price_service or PriceService(db=db)
        self.valuation_service = valuation_service or HoldingValuationService(
            db=db, fx=fx, price_service=self.price_service
        )

    def sync_account(self, account_id: UUID, on: date | None = None) -> None:
        on = on or date.today()
        account = self.db.query(Account).filter_by(id=account_id).one()
        if account.account_type == "investment_manual":
            self._sync_manual(account, on)
        else:
            raise ValueError(f"Account {account_id} is not an investment account")

    def _sync_manual(self, account: Account, on: date) -> None:
        holdings = self.db.query(Holding).filter_by(account_id=account.id).all()
        symbols = sorted({h.symbol for h in holdings if h.instrument_type != "cash"})
        if symbols:
            self.price_service.get_or_fetch(symbols, on)
        self.valuation_service.compute(account_id=account.id, on=on)
        account.last_synced_at = datetime.now(timezone.utc)
        self.db.commit()
