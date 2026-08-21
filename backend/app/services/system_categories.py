"""Additive, idempotent system-category bootstrap.

Shared by the categories route (ensure-system-transfer-categories, driven by
the frontend's translated default-categories.ts seed list) and backend
mutation flows (transfer/interest transaction creation) that need a system
category to exist before referencing it by system_key. The seed lists here
use plain English names as a defensive fallback only — in practice these
categories already exist by the time a backend mutation runs, seeded via the
frontend's onboarding/ensure call with locale-correct names. Matching is by
system_key first, so a pre-existing translated row is never shadowed.
"""

from dataclasses import dataclass
from typing import List, Optional

from sqlalchemy.orm import Session

from app.models import Category


@dataclass
class SystemCategorySeed:
    key: str
    name: str
    category_type: str
    color: str
    icon: str
    description: Optional[str] = None
    hide_from_selection: bool = False


TRANSFER_CATEGORY_SEEDS: List[SystemCategorySeed] = [
    SystemCategorySeed(
        key="internal_transfer",
        name="Internal Transfer",
        category_type="transfer",
        color="#334155",
        icon="RiExchangeLine",
        description="Transfers between your own accounts to move money internally",
    ),
    SystemCategorySeed(
        key="external_transfer",
        name="External Transfer",
        category_type="transfer",
        color="#44403C",
        icon="RiArrowLeftRightLine",
        description="Money moved to or from external accounts, not tracked",
    ),
    SystemCategorySeed(
        key="balancing_transfer",
        name="Balancing Transfer",
        category_type="transfer",
        color="#52525B",
        icon="RiScalesLine",
        description="Balance adjustments for account reconciliation",
        hide_from_selection=True,
    ),
    SystemCategorySeed(
        key="savings_transfer",
        name="Savings Transfer",
        category_type="transfer",
        color="#047857",
        icon="RiSafe2Line",
        description="Transfers moved into your savings accounts",
    ),
    SystemCategorySeed(
        key="investment_transfer",
        name="Investment Transfer",
        category_type="transfer",
        color="#1E40AF",
        icon="RiLineChartLine",
        description="Transfers moved into your investment accounts",
    ),
    SystemCategorySeed(
        key="credit_card_payment",
        name="Credit Card Payment",
        category_type="transfer",
        color="#9A3412",
        icon="RiBankCardLine",
        description="Payments made towards your credit card balance",
    ),
]

INTEREST_CATEGORY_SEEDS: List[SystemCategorySeed] = [
    SystemCategorySeed(
        key="savings_interest",
        name="Interest",
        category_type="income",
        color="#047857",
        icon="RiPercentLine",
        description="Interest earned on savings accounts",
    ),
]


def ensure_system_categories(
    db: Session, user_id: str, seeds: List[SystemCategorySeed]
) -> List[Category]:
    """Insert any of ``seeds`` the user doesn't already have (matched by
    system_key, falling back to name for pre-migration categories), without
    touching existing categories. Flushes but does not commit — caller owns
    the transaction boundary.
    """
    existing = (
        db.query(Category.name, Category.system_key).filter(Category.user_id == user_id).all()
    )
    existing_keys = {row.system_key for row in existing if row.system_key}
    existing_names = {row.name for row in existing}

    inserted: List[Category] = []
    for seed in seeds:
        if seed.key in existing_keys or seed.name in existing_names:
            continue
        category = Category(
            user_id=user_id,
            name=seed.name,
            category_type=seed.category_type,
            color=seed.color,
            icon=seed.icon,
            description=seed.description,
            is_system=True,
            hide_from_selection=seed.hide_from_selection,
            system_key=seed.key,
        )
        db.add(category)
        inserted.append(category)

    if inserted:
        db.flush()

    return inserted
