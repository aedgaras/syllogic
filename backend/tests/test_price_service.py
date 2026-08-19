from datetime import date
from decimal import Decimal
from unittest.mock import MagicMock

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.models import PriceSnapshot
from app.services.price_service import PriceService
from app.integrations.price_provider.base import PriceQuote


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:")
    # Only create tables that work with SQLite (no JSONB etc.)
    PriceSnapshot.__table__.create(bind=engine)
    with Session(engine) as session:
        yield session


def test_returns_cached_snapshot_without_calling_provider(db):
    db.add(
        PriceSnapshot(
            symbol="AAPL",
            currency="USD",
            date=date(2026, 4, 18),
            close=Decimal("234.56"),
            provider="yahoo",
        )
    )
    db.commit()
    provider = MagicMock()
    svc = PriceService(db=db, provider=provider)
    out = svc.get_or_fetch(["AAPL"], date(2026, 4, 18))
    assert out["AAPL"].close == Decimal("234.56")
    provider.get_daily_closes.assert_not_called()


def test_fetches_missing_and_persists(db):
    provider = MagicMock()
    provider.get_daily_closes.return_value = {
        "MSFT": PriceQuote("MSFT", "USD", date(2026, 4, 18), Decimal("410.10")),
    }
    provider.name = "yahoo"
    svc = PriceService(db=db, provider=provider)
    out = svc.get_or_fetch(["MSFT"], date(2026, 4, 18))
    assert out["MSFT"].close == Decimal("410.10")
    persisted = db.query(PriceSnapshot).filter_by(symbol="MSFT").one()
    assert persisted.close == Decimal("410.10")
    assert persisted.provider == "yahoo"


def test_partial_miss(db):
    db.add(
        PriceSnapshot(
            symbol="AAPL",
            currency="USD",
            date=date(2026, 4, 18),
            close=Decimal("234.56"),
            provider="yahoo",
        )
    )
    db.commit()
    provider = MagicMock()
    provider.get_daily_closes.return_value = {
        "MSFT": PriceQuote("MSFT", "USD", date(2026, 4, 18), Decimal("410.10")),
    }
    provider.name = "yahoo"
    svc = PriceService(db=db, provider=provider)
    out = svc.get_or_fetch(["AAPL", "MSFT"], date(2026, 4, 18))
    assert set(out.keys()) == {"AAPL", "MSFT"}
    provider.get_daily_closes.assert_called_once_with(["MSFT"], date(2026, 4, 18))


def test_historical_date_caches_under_requested_date_not_quote_date(db):
    """For a past (immutable) date, the provider may return a quote dated
    earlier than `on` (e.g. Friday's close for a requested Saturday). The
    cache must key on `on`, not the provider's quote.date, or `on` is a
    permanent cache-miss on every later call regardless of frequency."""
    provider = MagicMock()
    provider.get_daily_closes.return_value = {
        "MSFT": PriceQuote("MSFT", "USD", date(2026, 4, 17), Decimal("400.00")),
    }
    provider.name = "yahoo"
    svc = PriceService(db=db, provider=provider)

    out = svc.get_or_fetch(["MSFT"], date(2026, 4, 18))
    assert out["MSFT"].close == Decimal("400.00")
    persisted = db.query(PriceSnapshot).filter_by(symbol="MSFT").one()
    assert persisted.date == date(2026, 4, 18)

    # Second call for the same past date is a cache hit, no re-fetch.
    out2 = svc.get_or_fetch(["MSFT"], date(2026, 4, 18))
    assert out2["MSFT"].close == Decimal("400.00")
    provider.get_daily_closes.assert_called_once()


def test_current_day_is_never_served_from_cache_and_self_corrects(db):
    """Today's close isn't final until the market shuts, so — unlike a past
    date — today is never treated as cached: every call re-fetches, and a
    later same-day run overwrites (upserts) an earlier placeholder once the
    real close for today becomes available."""
    today = date.today()
    provider = MagicMock()
    provider.name = "yahoo"
    svc = PriceService(db=db, provider=provider)

    # Pre-close run: provider's last-available close is yesterday's.
    provider.get_daily_closes.return_value = {
        "MSFT": PriceQuote("MSFT", "USD", today, Decimal("400.00")),
    }
    out1 = svc.get_or_fetch(["MSFT"], today)
    assert out1["MSFT"].close == Decimal("400.00")
    assert db.query(PriceSnapshot).filter_by(symbol="MSFT").one().date == today

    # Post-close run same day: provider now has the real close. Must
    # re-fetch (not served from cache) and overwrite the placeholder.
    provider.get_daily_closes.return_value = {
        "MSFT": PriceQuote("MSFT", "USD", today, Decimal("405.50")),
    }
    out2 = svc.get_or_fetch(["MSFT"], today)
    assert out2["MSFT"].close == Decimal("405.50")
    assert provider.get_daily_closes.call_count == 2
    persisted = db.query(PriceSnapshot).filter_by(symbol="MSFT").one()
    assert persisted.close == Decimal("405.50")
