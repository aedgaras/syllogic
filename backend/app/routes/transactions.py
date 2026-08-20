from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload, aliased
from sqlalchemy import func, or_, and_, asc, desc, case, select, false
from typing import List, Optional
from uuid import UUID
from datetime import datetime, timedelta
from enum import Enum

from app.database import get_db
from app.models import Transaction, Account, Category, InternalTransfer, TransactionLink, User
from app.db_helpers import get_user_id
from app.schemas import (
    AccountDeleteImpact,
    AccruedInterestResponse,
    BalancingTransactionUpsert,
    BalancingTransactionUpsertResponse,
    BulkAnalyticsUpdateRequest,
    BulkCategoryUpdateRequest,
    BulkDeleteRequest,
    BulkDeleteResponse,
    BulkUpdateResponse,
    CategoryAssign,
    CategorySpending,
    CategorySpendingCategoryResponse,
    CategorySpendingDataResponse,
    CategorySpendingRangeResponse,
    CategorySpendingSummaryResponse,
    CategorySpendingTopCategoryResponse,
    CategorySpendingTransactionsPageResponse,
    DeleteImpactRequest,
    DeleteImpactResponse,
    FilteredTransactionTotalsResponse,
    IncludeInAnalyticsUpdate,
    InterestTransactionCreate,
    InterestTransactionResponse,
    TransactionConvertToTransferRequest,
    TransactionCreate,
    TransactionPageResponse,
    TransactionResponse,
    TransactionUpdate,
    TransactionWithDetails,
    TransferTransactionCreate,
    TransferTransactionResponse,
)
from app.services.transaction_mutation_service import TransactionMutationService

router = APIRouter()

_DETAIL_RELATIONS = (
    joinedload(Transaction.account).joinedload(Account.logo),
    joinedload(Transaction.category),
    joinedload(Transaction.category_system),
    joinedload(Transaction.recurring_transaction),
    joinedload(Transaction.transaction_link),
    joinedload(Transaction.internal_transfer).joinedload(InternalTransfer.source_account),
    joinedload(Transaction.internal_transfer).joinedload(InternalTransfer.pocket_account),
)


def _serialize_transaction(txn: Transaction) -> TransactionWithDetails:
    return TransactionWithDetails(
        id=txn.id,
        account_id=txn.account_id,
        external_id=txn.external_id,
        transaction_type=txn.transaction_type,
        amount=txn.amount,
        currency=txn.currency,
        description=txn.description,
        merchant=txn.merchant,
        creditor=txn.creditor,
        debtor=txn.debtor,
        functional_amount=txn.functional_amount,
        category_id=txn.category_id,
        category_system_id=txn.category_system_id,
        internal_transfer_id=txn.internal_transfer_id,
        recurring_transaction_id=txn.recurring_transaction_id,
        include_in_analytics=txn.include_in_analytics,
        csv_import_id=txn.csv_import_id,
        booked_at=txn.booked_at,
        pending=txn.pending,
        categorization_instructions=txn.categorization_instructions,
        enrichment_data=txn.enrichment_data,
        created_at=txn.created_at,
        updated_at=txn.updated_at,
        category_name=txn.category.name if txn.category else None,
        account_name=txn.account.name,
        account=txn.account,
        category=txn.category,
        category_system=txn.category_system,
        recurring_transaction=txn.recurring_transaction,
        transaction_link=txn.transaction_link,
        internal_transfer=txn.internal_transfer,
    )


class SortBy(str, Enum):
    description = "description"
    account = "account"
    category = "category"
    date = "date"
    amount = "amount"


class SortOrder(str, Enum):
    asc = "asc"
    desc = "desc"


class TransactionTypeFilter(str, Enum):
    income = "income"
    expense = "expense"


@router.get("/", response_model=List[TransactionWithDetails])
def list_transactions(
    account_id: Optional[UUID] = None,
    category_id: Optional[UUID] = None,
    uncategorized: Optional[bool] = None,
    from_date: Optional[datetime] = Query(None, alias="from"),
    to_date: Optional[datetime] = Query(None, alias="to"),
    search: Optional[str] = None,
    page: int = 1,
    limit: int = 50,
    sort_by: Optional[SortBy] = Query(None, alias="sort_by"),
    sort_order: Optional[SortOrder] = Query(SortOrder.desc, alias="sort_order"),
    type: Optional[TransactionTypeFilter] = Query(None, alias="type"),
    pending: Optional[bool] = None,
    recurring_transaction_id: Optional[UUID] = None,
    no_subscription: Optional[bool] = None,
    include_in_analytics: Optional[bool] = None,
    min_amount: Optional[float] = None,
    max_amount: Optional[float] = None,
    user_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """List transactions for the current user."""
    user_id = get_user_id(user_id)
    query = db.query(Transaction).filter(Transaction.user_id == user_id).options(*_DETAIL_RELATIONS)

    if account_id:
        query = query.filter(Transaction.account_id == account_id)

    if category_id:
        # Match effective category: user override first, otherwise AI-assigned fallback
        query = query.filter(
            (Transaction.category_id == category_id)
            | and_(Transaction.category_id.is_(None), Transaction.category_system_id == category_id)
        )

    if uncategorized:
        query = query.filter(
            Transaction.category_id.is_(None), Transaction.category_system_id.is_(None)
        )

    if from_date:
        query = query.filter(Transaction.booked_at >= from_date)

    if to_date:
        query = query.filter(Transaction.booked_at <= to_date)

    if search:
        search_term = f"%{search}%"
        query = query.filter(
            or_(
                Transaction.description.ilike(search_term),
                Transaction.merchant.ilike(search_term),
            )
        )

    # Filter by income/expense type
    if type == TransactionTypeFilter.income:
        query = query.filter(Transaction.amount > 0)
    elif type == TransactionTypeFilter.expense:
        query = query.filter(Transaction.amount < 0)

    if pending is not None:
        if pending:
            query = query.filter(Transaction.pending.is_(True))
        else:
            query = query.filter(or_(Transaction.pending.is_(False), Transaction.pending.is_(None)))

    if recurring_transaction_id and no_subscription:
        query = query.filter(
            or_(
                Transaction.recurring_transaction_id == recurring_transaction_id,
                Transaction.recurring_transaction_id.is_(None),
            )
        )
    elif recurring_transaction_id:
        query = query.filter(Transaction.recurring_transaction_id == recurring_transaction_id)
    elif no_subscription:
        query = query.filter(Transaction.recurring_transaction_id.is_(None))

    if include_in_analytics is not None:
        query = query.filter(Transaction.include_in_analytics == include_in_analytics)

    if min_amount is not None:
        query = query.filter(func.abs(Transaction.amount) >= min_amount)
    if max_amount is not None:
        query = query.filter(func.abs(Transaction.amount) <= max_amount)

    # Apply sorting
    if sort_by:
        order_func = asc if sort_order == SortOrder.asc else desc
        if sort_by == SortBy.description:
            query = query.order_by(order_func(Transaction.description))
        elif sort_by == SortBy.account:
            query = query.join(Account).order_by(order_func(Account.name))
        elif sort_by == SortBy.category:
            query = query.outerjoin(Category).order_by(order_func(Category.name))
        elif sort_by == SortBy.date:
            query = query.order_by(order_func(Transaction.booked_at))
        elif sort_by == SortBy.amount:
            query = query.order_by(order_func(Transaction.amount))
    else:
        # Default sorting by date descending
        query = query.order_by(Transaction.booked_at.desc())

    offset = (page - 1) * limit
    transactions = query.offset(offset).limit(limit).all()

    return [_serialize_transaction(txn) for txn in transactions]


def _latest_booked_at_for_scope(db: Session, user_id: str, account_ids: List[UUID]) -> datetime:
    query = db.query(func.max(Transaction.booked_at)).filter(Transaction.user_id == user_id)
    if account_ids:
        query = query.filter(Transaction.account_id.in_(account_ids))
    latest = query.scalar()
    return latest or datetime.utcnow()


def _build_page_where(
    db: Session,
    user_id: str,
    account_ids: List[UUID],
    category: List[str],
    status: List[str],
    subscription: List[str],
    analytics: List[str],
    min_amount: Optional[float],
    max_amount: Optional[float],
    search: Optional[str],
    from_date: Optional[str],
    to_date: Optional[str],
    horizon: Optional[int],
):
    conditions = [Transaction.user_id == user_id]
    if account_ids:
        conditions.append(Transaction.account_id.in_(account_ids))

    resolved_from: Optional[datetime] = None
    resolved_to: Optional[datetime] = None
    effective_horizon: Optional[int] = None

    if from_date:
        resolved_from = datetime.strptime(from_date, "%Y-%m-%d")
        if to_date:
            resolved_to = datetime.strptime(to_date, "%Y-%m-%d").replace(
                hour=23, minute=59, second=59, microsecond=999000
            )
        else:
            resolved_to = _latest_booked_at_for_scope(db, user_id, account_ids).replace(
                hour=23, minute=59, second=59, microsecond=999000
            )
        if resolved_to < resolved_from:
            resolved_to = resolved_from.replace(hour=23, minute=59, second=59, microsecond=999000)
    elif horizon:
        resolved_to = _latest_booked_at_for_scope(db, user_id, account_ids).replace(
            hour=23, minute=59, second=59, microsecond=999000
        )
        effective_horizon = horizon
        resolved_from = (resolved_to - timedelta(days=horizon - 1)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )

    if resolved_from:
        conditions.append(Transaction.booked_at >= resolved_from)
    if resolved_to:
        conditions.append(Transaction.booked_at <= resolved_to)

    if search:
        search_term = f"%{search}%"
        conditions.append(
            or_(Transaction.description.ilike(search_term), Transaction.merchant.ilike(search_term))
        )

    category_ids = [c for c in category if c != "uncategorized"]
    include_uncategorized = "uncategorized" in category
    if category_ids or include_uncategorized:
        category_conditions = []
        if category_ids:
            category_conditions.append(Transaction.category_id.in_(category_ids))
            category_conditions.append(
                and_(
                    Transaction.category_id.is_(None),
                    Transaction.category_system_id.in_(category_ids),
                )
            )
        if include_uncategorized:
            category_conditions.append(
                and_(Transaction.category_id.is_(None), Transaction.category_system_id.is_(None))
            )
        conditions.append(or_(*category_conditions))

    includes_pending = "pending" in status
    includes_completed = "completed" in status
    if includes_pending != includes_completed:
        conditions.append(
            Transaction.pending.is_(True)
            if includes_pending
            else or_(Transaction.pending.is_(False), Transaction.pending.is_(None))
        )

    subscription_ids = [s for s in subscription if s != "no_subscription"]
    includes_no_subscription = "no_subscription" in subscription
    if subscription_ids or includes_no_subscription:
        subscription_conditions = []
        if subscription_ids:
            subscription_conditions.append(
                Transaction.recurring_transaction_id.in_(subscription_ids)
            )
        if includes_no_subscription:
            subscription_conditions.append(Transaction.recurring_transaction_id.is_(None))
        conditions.append(or_(*subscription_conditions))

    includes_analytics = "included" in analytics
    includes_non_analytics = "excluded" in analytics
    if includes_analytics != includes_non_analytics:
        conditions.append(Transaction.include_in_analytics.is_(includes_analytics))

    if min_amount is not None:
        conditions.append(func.abs(Transaction.amount) >= min_amount)
    if max_amount is not None:
        conditions.append(func.abs(Transaction.amount) <= max_amount)

    return and_(*conditions), resolved_from, resolved_to, effective_horizon


def _page_sort_order(sort: Optional[str], order: str):
    order_func = asc if order == "asc" else desc
    if sort == "amount":
        return [order_func(Transaction.amount), desc(Transaction.booked_at)]
    if sort == "description":
        return [order_func(Transaction.description), desc(Transaction.booked_at)]
    if sort == "merchant":
        return [order_func(Transaction.merchant), desc(Transaction.booked_at)]
    return [order_func(Transaction.booked_at), desc(Transaction.id)]


@router.get("/page", response_model=TransactionPageResponse)
def get_transaction_page(
    account_ids: Optional[List[UUID]] = Query(None),
    category: Optional[List[str]] = Query(None),
    status: Optional[List[str]] = Query(None),
    subscription: Optional[List[str]] = Query(None),
    analytics: Optional[List[str]] = Query(None),
    min_amount: Optional[float] = None,
    max_amount: Optional[float] = None,
    search: Optional[str] = None,
    from_date: Optional[str] = Query(None, alias="from"),
    to_date: Optional[str] = Query(None, alias="to"),
    horizon: Optional[int] = None,
    sort: Optional[str] = None,
    order: str = "desc",
    page: int = 1,
    page_size: int = 50,
    include_filtered_totals: bool = False,
    user_id: str = Depends(get_user_id),
    db: Session = Depends(get_db),
):
    """Paginated/filtered transaction list backing the frontend transactions
    table. Filters combine like the pre-migration Drizzle query builder:
    multi-value account/category/subscription filters, category and
    subscription each pair with an "uncategorized"/"no_subscription"
    sentinel, and date range resolves from an explicit from/to or a
    trailing-window horizon (in days) anchored to the latest transaction in
    scope."""
    where_clause, resolved_from, resolved_to, effective_horizon = _build_page_where(
        db,
        user_id,
        account_ids or [],
        category or [],
        status or [],
        subscription or [],
        analytics or [],
        min_amount,
        max_amount,
        search,
        from_date,
        to_date,
        horizon,
    )

    total_count = db.query(func.count(Transaction.id)).filter(where_clause).scalar() or 0

    rows = (
        db.query(Transaction)
        .filter(where_clause)
        .options(*_DETAIL_RELATIONS)
        .order_by(*_page_sort_order(sort, order))
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    filtered_totals = None
    if include_filtered_totals:
        totals_row = (
            db.query(
                func.coalesce(
                    func.sum(
                        case(
                            (
                                Transaction.transaction_type == "credit",
                                func.abs(Transaction.amount),
                            ),
                            (
                                and_(
                                    Transaction.transaction_type.is_(None), Transaction.amount > 0
                                ),
                                Transaction.amount,
                            ),
                            else_=0,
                        )
                    ),
                    0,
                ).label("total_in"),
                func.coalesce(
                    func.sum(
                        case(
                            (Transaction.transaction_type == "debit", func.abs(Transaction.amount)),
                            (
                                and_(
                                    Transaction.transaction_type.is_(None), Transaction.amount < 0
                                ),
                                func.abs(Transaction.amount),
                            ),
                            else_=0,
                        )
                    ),
                    0,
                ).label("total_out"),
            )
            .filter(where_clause)
            .one()
        )
        filtered_totals = FilteredTransactionTotalsResponse(
            total_in=totals_row.total_in, total_out=totals_row.total_out
        )

    return TransactionPageResponse(
        rows=[_serialize_transaction(txn) for txn in rows],
        total_count=total_count,
        filtered_totals=filtered_totals,
        page=page,
        page_size=page_size,
        resolved_from=resolved_from.strftime("%Y-%m-%d") if resolved_from else None,
        resolved_to=resolved_to.strftime("%Y-%m-%d") if resolved_to else None,
        effective_horizon=effective_horizon,
    )


@router.get("/stats/by-category", response_model=List[CategorySpending])
def get_spending_by_category(
    from_date: Optional[datetime] = Query(None, alias="from"),
    to_date: Optional[datetime] = Query(None, alias="to"),
    user_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Get spending statistics by category for the current user."""
    user_id = get_user_id(user_id)
    # Use category_id (user override) or category_system_id (AI assigned) for grouping
    query = (
        db.query(
            func.coalesce(Transaction.category_id, Transaction.category_system_id).label(
                "category_id"
            ),
            Category.name.label("category_name"),
            func.sum(Transaction.amount).label("total"),
            func.count(Transaction.id).label("count"),
        )
        .outerjoin(
            Category,
            (Transaction.category_id == Category.id)
            | (Transaction.category_system_id == Category.id),
        )
        .filter(Transaction.user_id == user_id)
    )

    # Only expenses (negative amounts)
    query = query.filter(Transaction.amount < 0)

    if from_date:
        query = query.filter(Transaction.booked_at >= from_date)
    if to_date:
        query = query.filter(Transaction.booked_at <= to_date)

    results = query.group_by(
        func.coalesce(Transaction.category_id, Transaction.category_system_id), Category.name
    ).all()

    return [
        CategorySpending(
            category_id=r.category_id,
            category_name=r.category_name or "Uncategorized",
            total=abs(r.total) if r.total else 0,
            count=r.count,
        )
        for r in results
    ]


def _end_of_day(value: datetime) -> datetime:
    return value.replace(hour=23, minute=59, second=59, microsecond=999000)


def _start_of_day(value: datetime) -> datetime:
    return value.replace(hour=0, minute=0, second=0, microsecond=0)


def _start_of_month(value: datetime) -> datetime:
    return value.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _end_of_month(value: datetime) -> datetime:
    if value.month == 12:
        next_month = value.replace(year=value.year + 1, month=1, day=1)
    else:
        next_month = value.replace(month=value.month + 1, day=1)
    return _end_of_day(next_month - timedelta(days=1))


def _resolve_category_spending_range(
    db: Session,
    user_id: str,
    account_ids: List[UUID],
    from_date: Optional[str],
    to_date: Optional[str],
    horizon: Optional[int],
):
    """Resolves the primary [start_date, end_date] window (explicit from/to,
    a trailing horizon, or the current month by default) plus its
    period-over-period comparison window and the number of calendar months
    it touches. Mirrors category-spending.ts's resolvePrimaryRange +
    computePreviousWindow + getTouchedMonthKeys."""
    reference_date = _latest_booked_at_for_scope(db, user_id, account_ids)

    if from_date:
        start_date = datetime.strptime(from_date, "%Y-%m-%d")
        end_date = (
            _end_of_day(datetime.strptime(to_date, "%Y-%m-%d"))
            if to_date
            else _end_of_day(reference_date)
        )
        if end_date < start_date:
            end_date = _end_of_day(start_date)
    elif horizon:
        end_date = _end_of_day(reference_date)
        start_date = _start_of_day(end_date - timedelta(days=horizon - 1))
    else:
        start_date = _start_of_month(reference_date)
        end_date = _end_of_month(reference_date)

    span_days = max(1, (end_date.date() - start_date.date()).days + 1)
    comparison_end = _end_of_day(start_date - timedelta(days=1))
    comparison_start = _start_of_day(comparison_end - timedelta(days=span_days - 1))
    month_count = max(
        1,
        (end_date.year * 12 + end_date.month) - (start_date.year * 12 + start_date.month) + 1,
    )

    return reference_date, start_date, end_date, comparison_start, comparison_end, month_count


def _fetch_category_amounts(
    db: Session,
    user_id: str,
    start_date: datetime,
    end_date: datetime,
    account_ids: List[UUID],
) -> List[dict]:
    """Sum of expense debits per category in [start_date, end_date], plus an
    "uncategorized" bucket. A transaction that's the primary leg of a linked
    group (reimbursement/expense-split) counts its group's net amount
    (if still a net expense) instead of its own amount, so a fully
    reimbursed expense doesn't inflate category spend; non-primary legs of a
    linked group are excluded entirely (already reflected in the primary's
    net amount)."""
    base_filters = [
        Transaction.user_id == user_id,
        Transaction.transaction_type == "debit",
        Transaction.include_in_analytics.is_(True),
        Transaction.booked_at >= start_date,
        Transaction.booked_at <= end_date,
    ]
    if account_ids:
        base_filters.append(Transaction.account_id.in_(account_ids))

    txn2 = aliased(Transaction)
    link2 = aliased(TransactionLink)
    net_amount_subquery = (
        select(
            case(
                (
                    func.coalesce(func.sum(txn2.amount), 0) < 0,
                    func.abs(func.coalesce(func.sum(txn2.amount), 0)),
                ),
                else_=0,
            )
        )
        .select_from(txn2)
        .join(link2, txn2.id == link2.transaction_id)
        .where(link2.group_id == TransactionLink.group_id, link2.group_id.isnot(None))
        .correlate(TransactionLink)
        .scalar_subquery()
    )
    amount_expr = func.coalesce(
        func.sum(
            case(
                (
                    and_(
                        TransactionLink.link_role == "primary",
                        TransactionLink.group_id.isnot(None),
                    ),
                    func.coalesce(net_amount_subquery, 0),
                ),
                (TransactionLink.link_role.isnot(None), 0),
                else_=func.abs(Transaction.amount),
            )
        ),
        0,
    )
    effective_category = func.coalesce(Transaction.category_id, Transaction.category_system_id)

    categorized_rows = (
        db.query(
            Category.id.label("id"),
            Category.name.label("name"),
            Category.color.label("color"),
            Category.icon.label("icon"),
            amount_expr.label("amount"),
        )
        .select_from(Transaction)
        .join(Category, Category.id == effective_category)
        .outerjoin(TransactionLink, TransactionLink.transaction_id == Transaction.id)
        .filter(*base_filters, Category.category_type == "expense")
        .group_by(Category.id, Category.name, Category.color, Category.icon)
        .all()
    )

    uncategorized_amount = (
        db.query(func.coalesce(func.sum(func.abs(Transaction.amount)), 0))
        .select_from(Transaction)
        .outerjoin(TransactionLink, TransactionLink.transaction_id == Transaction.id)
        .filter(
            *base_filters,
            Transaction.category_id.is_(None),
            Transaction.category_system_id.is_(None),
            TransactionLink.link_role.is_(None),
        )
        .scalar()
        or 0
    )

    items = [
        {
            "id": str(row.id),
            "name": row.name,
            "color": row.color,
            "icon": row.icon,
            "amount": float(row.amount or 0),
        }
        for row in categorized_rows
    ]
    if float(uncategorized_amount) > 0:
        items.append(
            {
                "id": "uncategorized",
                "name": "Uncategorized",
                "color": None,
                "icon": None,
                "amount": float(uncategorized_amount),
            }
        )
    items.sort(key=lambda item: item["amount"], reverse=True)
    return items


@router.get("/stats/category-spending", response_model=CategorySpendingDataResponse)
def get_category_spending_data(
    account_ids: Optional[List[UUID]] = Query(None),
    from_date: Optional[str] = Query(None, alias="from"),
    to_date: Optional[str] = Query(None, alias="to"),
    horizon: Optional[int] = None,
    user_id: str = Depends(get_user_id),
    db: Session = Depends(get_db),
):
    """Category spending breakdown for the resolved date window, with
    period-over-period deltas against the equal-length prior window computed
    server-side (avoids a two-round-trip-shaped payload)."""
    account_ids = account_ids or []
    user = db.query(User).filter(User.id == user_id).first()
    currency = (user.functional_currency if user else None) or "EUR"

    reference_date, start_date, end_date, comparison_start, comparison_end, month_count = (
        _resolve_category_spending_range(db, user_id, account_ids, from_date, to_date, horizon)
    )

    current_items = _fetch_category_amounts(db, user_id, start_date, end_date, account_ids)
    previous_items = _fetch_category_amounts(
        db, user_id, comparison_start, comparison_end, account_ids
    )
    previous_by_id = {item["id"]: item["amount"] for item in previous_items}

    total_spend = sum(item["amount"] for item in current_items)

    categories_response = []
    for item in current_items:
        previous_amount = previous_by_id.get(item["id"], 0)
        delta_amount = item["amount"] - previous_amount
        if previous_amount > 0:
            delta_pct = (delta_amount / previous_amount) * 100
        elif item["amount"] > 0:
            delta_pct = 100
        else:
            delta_pct = 0
        categories_response.append(
            CategorySpendingCategoryResponse(
                id=item["id"],
                name=item["name"],
                color=item["color"],
                icon=item["icon"],
                amount=item["amount"],
                share_pct=(item["amount"] / total_spend * 100) if total_spend > 0 else 0,
                delta_amount=delta_amount,
                delta_pct=delta_pct,
                average_monthly_amount=item["amount"] / month_count,
            )
        )

    top_category = (
        CategorySpendingTopCategoryResponse(
            id=categories_response[0].id,
            name=categories_response[0].name,
            amount=categories_response[0].amount,
        )
        if categories_response
        else None
    )

    return CategorySpendingDataResponse(
        currency=currency,
        categories=categories_response,
        summary=CategorySpendingSummaryResponse(
            total_spend=total_spend,
            average_monthly_spend=total_spend / month_count,
            top_category=top_category,
        ),
        range=CategorySpendingRangeResponse(
            start_date=start_date.strftime("%Y-%m-%d"),
            end_date=end_date.strftime("%Y-%m-%d"),
            comparison_start_date=comparison_start.strftime("%Y-%m-%d"),
            comparison_end_date=comparison_end.strftime("%Y-%m-%d"),
            month_count=month_count,
            reference_date=reference_date.strftime("%Y-%m-%d"),
        ),
    )


@router.get(
    "/stats/category-spending/transactions",
    response_model=CategorySpendingTransactionsPageResponse,
)
def get_category_spending_transactions_page(
    account_ids: Optional[List[UUID]] = Query(None),
    category: Optional[List[str]] = Query(None),
    from_date: Optional[str] = Query(None, alias="from"),
    to_date: Optional[str] = Query(None, alias="to"),
    horizon: Optional[int] = None,
    sort: Optional[str] = None,
    order: str = "desc",
    page: int = 1,
    page_size: int = 20,
    user_id: str = Depends(get_user_id),
    db: Session = Depends(get_db),
):
    """Transactions backing one category-spending window, restricted to the
    same expense-or-uncategorized bucket used by get_category_spending_data,
    optionally further filtered to specific categories."""
    account_ids = account_ids or []
    category = category or []
    page = max(1, page)
    page_size = max(10, min(100, page_size))

    _, start_date, end_date, _, _, _ = _resolve_category_spending_range(
        db, user_id, account_ids, from_date, to_date, horizon
    )

    expense_category_ids = [
        row.id
        for row in db.query(Category.id).filter(
            Category.user_id == user_id, Category.category_type == "expense"
        )
    ]
    effective_category = func.coalesce(Transaction.category_id, Transaction.category_system_id)
    uncategorized_condition = and_(
        Transaction.category_id.is_(None), Transaction.category_system_id.is_(None)
    )

    conditions = [
        Transaction.user_id == user_id,
        Transaction.transaction_type == "debit",
        Transaction.include_in_analytics.is_(True),
        Transaction.booked_at >= start_date,
        Transaction.booked_at <= end_date,
    ]
    if account_ids:
        conditions.append(Transaction.account_id.in_(account_ids))

    if expense_category_ids:
        conditions.append(
            or_(uncategorized_condition, effective_category.in_(expense_category_ids))
        )
    else:
        conditions.append(uncategorized_condition)

    if category:
        includes_uncategorized = "uncategorized" in category
        concrete_ids = [c for c in category if c != "uncategorized"]
        selected_conditions = []
        if concrete_ids:
            selected_conditions.append(effective_category.in_(concrete_ids))
        if includes_uncategorized:
            selected_conditions.append(uncategorized_condition)
        conditions.append(or_(*selected_conditions) if selected_conditions else false())

    where_clause = and_(*conditions)

    total_count = db.query(func.count(Transaction.id)).filter(where_clause).scalar() or 0

    rows = (
        db.query(Transaction)
        .filter(where_clause)
        .options(*_DETAIL_RELATIONS)
        .order_by(*_page_sort_order(sort, order))
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    return CategorySpendingTransactionsPageResponse(
        rows=[_serialize_transaction(txn) for txn in rows],
        total_count=total_count,
        page=page,
        page_size=page_size,
    )


@router.get("/{transaction_id}", response_model=TransactionResponse)
def get_transaction(
    transaction_id: UUID, user_id: Optional[str] = None, db: Session = Depends(get_db)
):
    """Get a specific transaction by ID."""
    user_id = get_user_id(user_id)
    transaction = (
        db.query(Transaction)
        .filter(Transaction.id == transaction_id, Transaction.user_id == user_id)
        .first()
    )
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return transaction


@router.post("/", response_model=TransactionResponse, status_code=201)
def create_transaction(
    transaction: TransactionCreate, user_id: Optional[str] = None, db: Session = Depends(get_db)
):
    """Create a new transaction."""
    user_id = get_user_id(user_id)
    # Verify account exists and belongs to user
    account = (
        db.query(Account)
        .filter(Account.id == transaction.account_id, Account.user_id == user_id)
        .first()
    )
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    # Verify category exists if provided
    if transaction.category_id:
        category = (
            db.query(Category)
            .filter(Category.id == transaction.category_id, Category.user_id == user_id)
            .first()
        )
        if not category:
            raise HTTPException(status_code=404, detail="Category not found")

    transaction_data = transaction.model_dump()
    transaction_data["user_id"] = user_id
    db_transaction = Transaction(**transaction_data)
    db.add(db_transaction)
    db.commit()
    db.refresh(db_transaction)
    return db_transaction


@router.patch("/{transaction_id}", response_model=TransactionResponse)
def update_transaction(
    transaction_id: UUID,
    updates: TransactionUpdate,
    user_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Update a transaction.

    Presence of account_id/amount/transaction_type/booked_at triggers the
    "full mutation" path: invariant checks (not an internal transfer, not a
    balancing transfer), currency/functional-amount recompute, and account
    balance recalculation for the old and new account. Otherwise this is a
    plain field patch (description, merchant, category, enrichment).
    """
    user_id = get_user_id(user_id)
    update_data = updates.model_dump(exclude_unset=True)
    service = TransactionMutationService(db, user_id)
    try:
        return service.update_transaction(transaction_id, update_data)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.patch("/{transaction_id}/category", response_model=TransactionResponse)
def assign_category(
    transaction_id: UUID,
    category_data: CategoryAssign,
    user_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Assign a category to a transaction (user override)."""
    user_id = get_user_id(user_id)
    transaction = (
        db.query(Transaction)
        .filter(Transaction.id == transaction_id, Transaction.user_id == user_id)
        .first()
    )
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")

    category = (
        db.query(Category)
        .filter(Category.id == category_data.category_id, Category.user_id == user_id)
        .first()
    )
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")

    # Set category_id (user override), keep category_system_id if it exists
    transaction.category_id = category_data.category_id
    db.commit()
    db.refresh(transaction)
    return transaction


@router.patch("/bulk/category", response_model=BulkUpdateResponse)
def bulk_update_category(
    payload: BulkCategoryUpdateRequest,
    user_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Bulk-assign (or clear, unlike the single assign endpoint) a category
    on a set of transactions."""
    user_id = get_user_id(user_id)
    if not payload.transaction_ids:
        raise HTTPException(status_code=400, detail="No transactions selected")

    if payload.category_id:
        category = (
            db.query(Category)
            .filter(Category.id == payload.category_id, Category.user_id == user_id)
            .first()
        )
        if not category:
            raise HTTPException(status_code=404, detail="Category not found")

    updated = (
        db.query(Transaction)
        .filter(Transaction.id.in_(payload.transaction_ids), Transaction.user_id == user_id)
        .update(
            {"category_id": payload.category_id, "updated_at": datetime.utcnow()},
            synchronize_session=False,
        )
    )
    db.commit()
    return BulkUpdateResponse(updated_count=updated)


@router.patch("/{transaction_id}/include-in-analytics", response_model=TransactionResponse)
def update_include_in_analytics(
    transaction_id: UUID,
    payload: IncludeInAnalyticsUpdate,
    user_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    user_id = get_user_id(user_id)
    transaction = (
        db.query(Transaction)
        .filter(Transaction.id == transaction_id, Transaction.user_id == user_id)
        .first()
    )
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")

    transaction.include_in_analytics = payload.include_in_analytics
    transaction.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(transaction)
    return transaction


@router.patch("/bulk/include-in-analytics", response_model=BulkUpdateResponse)
def bulk_update_include_in_analytics(
    payload: BulkAnalyticsUpdateRequest,
    user_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    user_id = get_user_id(user_id)
    if not payload.transaction_ids:
        raise HTTPException(status_code=400, detail="No transactions selected")

    updated = (
        db.query(Transaction)
        .filter(Transaction.id.in_(payload.transaction_ids), Transaction.user_id == user_id)
        .update(
            {
                "include_in_analytics": payload.include_in_analytics,
                "updated_at": datetime.utcnow(),
            },
            synchronize_session=False,
        )
    )
    db.commit()
    return BulkUpdateResponse(updated_count=updated)


@router.post("/transfer", response_model=TransferTransactionResponse)
def create_transfer_transaction(
    payload: TransferTransactionCreate,
    user_id: str = Depends(get_user_id),
    db: Session = Depends(get_db),
):
    """Create both sides of an account-to-account transfer, linked so the
    movement affects balances without counting as income/spending."""
    service = TransactionMutationService(db, user_id)
    try:
        source_txn, destination_txn = service.create_transfer(
            payload.source_account_id,
            payload.destination_account_id,
            payload.amount,
            payload.description,
            payload.booked_at,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return TransferTransactionResponse(
        source_transaction_id=source_txn.id, destination_transaction_id=destination_txn.id
    )


@router.post("/{transaction_id}/convert-to-transfer", response_model=TransferTransactionResponse)
def convert_transaction_to_transfer(
    transaction_id: UUID,
    payload: TransactionConvertToTransferRequest,
    user_id: str = Depends(get_user_id),
    db: Session = Depends(get_db),
):
    """Convert an existing standalone transaction into the source side of a
    transfer, creating and linking the destination side."""
    service = TransactionMutationService(db, user_id)
    try:
        source_txn, destination_txn = service.convert_to_transfer(
            transaction_id,
            payload.source_account_id,
            payload.destination_account_id,
            payload.amount,
            payload.description,
            payload.booked_at,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return TransferTransactionResponse(
        source_transaction_id=source_txn.id, destination_transaction_id=destination_txn.id
    )


@router.post("/interest", response_model=InterestTransactionResponse)
def add_interest_transaction(
    payload: InterestTransactionCreate,
    user_id: str = Depends(get_user_id),
    db: Session = Depends(get_db),
):
    """Record interest earned on a savings account, tagged with the system
    'Interest' category so it can be summed separately (see accrued-interest)."""
    service = TransactionMutationService(db, user_id)
    try:
        txn = service.add_interest(
            payload.account_id, payload.amount, payload.booked_at, payload.description
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return InterestTransactionResponse(transaction_id=txn.id)


@router.get("/accounts/{account_id}/accrued-interest", response_model=AccruedInterestResponse)
def get_accrued_interest(
    account_id: UUID,
    user_id: str = Depends(get_user_id),
    db: Session = Depends(get_db),
):
    """Sum of interest transactions (system 'savings_interest' category) for
    an account, for display as "accrued interest"."""
    service = TransactionMutationService(db, user_id)
    return AccruedInterestResponse(total=service.get_accrued_interest(account_id))


@router.put("/balancing", response_model=BalancingTransactionUpsertResponse)
def upsert_balancing_transaction(
    payload: BalancingTransactionUpsert,
    user_id: str = Depends(get_user_id),
    db: Session = Depends(get_db),
):
    """Create or update the balancing transfer for an account/date so the
    account's balance on that date matches target_balance. Deletes the
    existing balancing entry if the delta rounds to zero."""
    service = TransactionMutationService(db, user_id)
    try:
        transaction_id, is_update = service.create_or_update_balancing(
            payload.account_id,
            payload.target_balance,
            payload.adjustment_date,
            payload.balancing_category_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return BalancingTransactionUpsertResponse(transaction_id=transaction_id, is_update=is_update)


@router.delete("/{transaction_id}/balancing", status_code=204)
def delete_balancing_transaction(
    transaction_id: UUID,
    user_id: str = Depends(get_user_id),
    db: Session = Depends(get_db),
):
    """Delete a balancing transfer and recalculate balances, reverting the
    adjustment as if it never existed."""
    service = TransactionMutationService(db, user_id)
    try:
        service.delete_balancing(transaction_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return None


@router.post("/delete-impact", response_model=DeleteImpactResponse)
def get_delete_impact(
    payload: DeleteImpactRequest,
    user_id: str = Depends(get_user_id),
    db: Session = Depends(get_db),
):
    """Compute the balance impact of deleting a set of transactions without
    modifying any data (delete confirmation dialog)."""
    if not payload.transaction_ids:
        raise HTTPException(status_code=400, detail="No transactions selected")
    service = TransactionMutationService(db, user_id)
    try:
        impacts, total_transactions, earliest_date = service.get_delete_impact(
            payload.transaction_ids
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return DeleteImpactResponse(
        account_impacts=[AccountDeleteImpact(**impact) for impact in impacts],
        total_transactions=total_transactions,
        earliest_date=earliest_date,
    )


@router.post("/bulk-delete", response_model=BulkDeleteResponse)
def bulk_delete_transactions(
    payload: BulkDeleteRequest,
    user_id: str = Depends(get_user_id),
    db: Session = Depends(get_db),
):
    """Permanently delete a set of transactions (expanding to include both
    legs of any linked transfer) and recalculate affected account balances."""
    if not payload.transaction_ids:
        raise HTTPException(status_code=400, detail="No transactions selected")
    service = TransactionMutationService(db, user_id)
    try:
        affected_account_ids, deleted_count = service.bulk_delete(payload.transaction_ids)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return BulkDeleteResponse(
        affected_account_ids=affected_account_ids, deleted_count=deleted_count
    )


@router.delete("/{transaction_id}", status_code=204)
def delete_transaction(
    transaction_id: UUID, user_id: Optional[str] = None, db: Session = Depends(get_db)
):
    """Delete a transaction."""
    user_id = get_user_id(user_id)
    transaction = (
        db.query(Transaction)
        .filter(Transaction.id == transaction_id, Transaction.user_id == user_id)
        .first()
    )
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")

    db.delete(transaction)
    db.commit()
    return None


@router.delete("/by-account/{account_id}", status_code=200)
def delete_transactions_by_account(
    account_id: UUID, user_id: Optional[str] = None, db: Session = Depends(get_db)
):
    """
    Delete all transactions for a specific account.
    Use with caution - this permanently deletes all transactions.
    """
    from app.models import Account

    user_id = get_user_id(user_id)

    # Verify account exists and belongs to the requesting user
    account = db.query(Account).filter(Account.id == account_id, Account.user_id == user_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    # Count transactions before deletion
    transaction_count = (
        db.query(Transaction)
        .filter(Transaction.account_id == account_id, Transaction.user_id == user_id)
        .count()
    )

    # Delete all transactions for this account
    db.query(Transaction).filter(
        Transaction.account_id == account_id, Transaction.user_id == user_id
    ).delete()
    db.commit()

    return {
        "message": f"Deleted {transaction_count} transaction(s) for account '{account.name}'",
        "deleted_count": transaction_count,
        "account_name": account.name,
    }
