"""
Report how many transactions can be stated in their user's functional currency.

Read-only. Deliberately excluded from run_all.py -- this answers a question,
it does not change anything, and it is meant to be re-run after any backfill.

Why it exists: the MCP analytics aggregates sum

    CASE WHEN t.functional_amount IS NOT NULL THEN t.functional_amount
         WHEN t.currency = <functional> THEN t.amount
         ELSE NULL END

so a row in a foreign currency with no functional_amount contributes NULL and
is counted into `unconverted_transaction_count` rather than being folded into
the total at face value. That is correct, but it means the size of the
"cannot be counted" bucket decides whether analytics are materially complete.

`functional_amount` is NULL whenever no exchange rate was on record at import
time (see app/routes/transaction_import.py and
app/services/recurring_transaction_generator.py), so this is an ongoing
condition, not a legacy one.

Usage (from backend/):
    python postgres_migration/report_functional_amount_coverage.py
"""

from __future__ import annotations

import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from sqlalchemy import create_engine, text

from app.database import db_url


BREAKDOWN_SQL = """
SELECT
    (t.currency = COALESCE(u.functional_currency, 'EUR')) AS same_currency,
    (t.functional_amount IS NULL)                         AS unconverted,
    count(*)                                              AS n
FROM transactions t
JOIN users u ON u.id = t.user_id
GROUP BY 1, 2
ORDER BY 1, 2;
"""

# The cell that actually matters: foreign currency AND no converted amount.
# These rows cannot be aggregated at all.
BY_CURRENCY_SQL = """
SELECT
    t.currency,
    COALESCE(u.functional_currency, 'EUR') AS functional_currency,
    count(*)                               AS n
FROM transactions t
JOIN users u ON u.id = t.user_id
WHERE t.functional_amount IS NULL
  AND t.currency <> COALESCE(u.functional_currency, 'EUR')
GROUP BY 1, 2
ORDER BY n DESC
LIMIT 20;
"""

ACCOUNTS_SQL = """
SELECT count(*) AS n
FROM accounts a
JOIN users u ON u.id = a.user_id
WHERE a.functional_balance IS NULL
  AND a.currency <> COALESCE(u.functional_currency, 'EUR')
  AND a.is_active = true;
"""


def main() -> int:
    engine = create_engine(db_url)
    with engine.connect() as conn:
        total = conn.execute(text("SELECT count(*) FROM transactions")).scalar() or 0

        print(f"transactions: {total}")
        if total == 0:
            return 0

        print("\nbreakdown:")
        blocked = 0
        for row in conn.execute(text(BREAKDOWN_SQL)):
            label = (
                f"  same_currency={str(row.same_currency):<5} unconverted={str(row.unconverted):<5}"
            )
            print(f"{label} {row.n:>10}  ({row.n / total:6.2%})")
            if not row.same_currency and row.unconverted:
                blocked = row.n

        print(
            f"\nnot countable in the user's currency: {blocked} "
            f"({blocked / total:.2%} of all transactions)"
        )
        if blocked:
            print("\nby currency pair:")
            for row in conn.execute(text(BY_CURRENCY_SQL)):
                print(f"  {row.currency} -> {row.functional_currency}: {row.n}")
            print(
                "\nEach pair above needs a row in exchange_rates before those "
                "transactions can be aggregated. Until then analytics report "
                "them via unconverted_transaction_count."
            )

        accounts = conn.execute(text(ACCOUNTS_SQL)).scalar() or 0
        print(f"\nactive accounts with no functional_balance in a foreign currency: {accounts}")
        print("(these are excluded from total_balance in get_financial_summary)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
