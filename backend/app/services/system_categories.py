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
    group_key: Optional[str] = None


GROUP_CATEGORY_SEEDS: List[SystemCategorySeed] = [
    SystemCategorySeed(
        key="group_needs",
        name="Needs",
        category_type="expense",
        color="#0F766E",
        icon="RiShieldCheckLine",
        description="Essential spending you cannot easily go without",
        hide_from_selection=True,
    ),
    SystemCategorySeed(
        key="group_wants",
        name="Wants",
        category_type="expense",
        color="#7C3AED",
        icon="RiSparklingLine",
        description="Discretionary spending you choose to make",
        hide_from_selection=True,
    ),
    SystemCategorySeed(
        key="group_savings",
        name="Savings, Investments",
        category_type="transfer",
        color="#047857",
        icon="RiSafe2Line",
        description="Money you move into savings and investment accounts",
        hide_from_selection=True,
    ),
    SystemCategorySeed(
        key="group_income",
        name="Income",
        category_type="income",
        color="#65A30D",
        icon="RiMoneyEuroBoxLine",
        description="Money coming in",
        hide_from_selection=True,
    ),
]


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
        group_key="group_savings",
    ),
    SystemCategorySeed(
        key="investment_transfer",
        name="Investment Transfer",
        category_type="transfer",
        color="#1E40AF",
        icon="RiLineChartLine",
        description="Transfers moved into your investment accounts",
        group_key="group_savings",
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
        group_key="group_income",
    ),
]


def ensure_system_categories(
    db: Session, user_id: str, seeds: List[SystemCategorySeed]
) -> List[Category]:
    """Insert any of ``seeds`` the user doesn't already have (matched by
    system_key, falling back to name for pre-migration categories), without
    touching existing categories. Seeds carrying ``group_key`` are parented to
    the group category with that system_key once it exists (seeded here or
    already present); ungrouped rows that already existed are adopted too, so
    an existing user picks up the group structure. A missing group simply
    leaves the category ungrouped.
    Flushes but does not commit — caller owns the transaction boundary.
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

    # Parent every seed that names a group - including rows that already
    # existed but were never grouped, so an existing user picks up the new
    # structure. A row that is already in some group is left alone.
    grouped_seeds = [seed for seed in seeds if seed.group_key]
    if grouped_seeds:
        keys = {seed.group_key for seed in grouped_seeds}
        keys.update(seed.key for seed in grouped_seeds)
        rows = (
            db.query(Category)
            .filter(Category.user_id == user_id, Category.system_key.in_(keys))
            .all()
        )
        by_key = {row.system_key: row for row in rows}

        reparented = False
        for seed in grouped_seeds:
            category = by_key.get(seed.key)
            parent = by_key.get(seed.group_key)
            if not category or not parent or parent.id == category.id:
                continue
            if category.parent_id is None:
                category.parent_id = parent.id
                reparented = True
        if reparented:
            db.flush()

    return inserted
