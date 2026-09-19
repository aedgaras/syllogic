"""
Transaction tools for the MCP server.
"""

from __future__ import annotations

import base64
import json
from datetime import datetime
from decimal import Decimal
from typing import Optional, Literal

from sqlalchemy import or_, and_, func
from sqlalchemy.orm import joinedload

from app.mcp.dependencies import (
    get_db,
    require_date_bound,
    require_uuid,
    require_uuid_list,
    validate_uuid,
)
from app.mcp.errors import (
    missing_argument,
    not_found,
    out_of_range,
    raise_database_error,
)
from app.mcp.tools._writes import mutation_result, preview_or_commit, snapshot
from app.models import Transaction, Category


def _category_candidates(db, user_id: str) -> list[tuple[str, str]]:
    """(name, id) pairs for a not_found message, from the caller's session."""
    return [
        (name, str(cid))
        for cid, name in db.query(Category.id, Category.name)
        .filter(Category.user_id == user_id)
        .order_by(Category.name)
        .all()
    ]


# Type alias for match modes
MatchMode = Literal["contains", "starts_with", "word"]

# Type alias for sort modes
SortBy = Literal[
    "booked_at_desc",
    "booked_at_asc",
    "amount_desc",
    "amount_asc",
    "abs_amount_desc",
]


def _sort_expr(sort_by: SortBy):
    """Return (primary_col, direction_func) for the given sort mode."""
    if sort_by == "booked_at_asc":
        return Transaction.booked_at, lambda c: c.asc()
    if sort_by == "amount_desc":
        return Transaction.amount, lambda c: c.desc()
    if sort_by == "amount_asc":
        return Transaction.amount, lambda c: c.asc()
    if sort_by == "abs_amount_desc":
        return func.abs(Transaction.amount), lambda c: c.desc()
    return Transaction.booked_at, lambda c: c.desc()  # booked_at_desc default


def _encode_cursor(primary_value, txn_id: str) -> str:
    payload = {"v": str(primary_value), "id": txn_id}
    return base64.urlsafe_b64encode(json.dumps(payload).encode()).decode()


def _decode_cursor(cursor: str) -> tuple[str, str]:
    payload = json.loads(base64.urlsafe_b64decode(cursor.encode()).decode())
    return payload["v"], payload["id"]


def _paginate_query(query, cursor: Optional[str], sort_by: SortBy, limit: int):
    """Apply sort and (optionally) cursor filter. Returns ordered, limited query."""
    primary_col, direction = _sort_expr(sort_by)
    if cursor:
        try:
            v, last_id = _decode_cursor(cursor)
        except Exception:
            raise ValueError("Invalid cursor")
        # Coerce the primary value to a type Postgres can compare against the
        # primary column: timestamps must not be compared as strings, and
        # numeric columns are safer as Decimal/float.
        if sort_by in ("booked_at_desc", "booked_at_asc"):
            v = datetime.fromisoformat(v)
        else:
            v = Decimal(v)
        # Sort-aware cursor filter: rows "after" (primary, id) tuple
        is_desc = sort_by in ("booked_at_desc", "amount_desc", "abs_amount_desc")
        if is_desc:
            query = query.filter(
                or_(primary_col < v, and_(primary_col == v, Transaction.id < last_id))
            )
        else:
            query = query.filter(
                or_(primary_col > v, and_(primary_col == v, Transaction.id > last_id))
            )
    return query.order_by(direction(primary_col), direction(Transaction.id)).limit(limit)


def _build_next_cursor(rows: list, sort_by: SortBy, limit: int) -> Optional[str]:
    if len(rows) < limit:
        return None
    last = rows[-1]
    # Extract raw primary value for the sort mode
    if sort_by in ("booked_at_desc", "booked_at_asc"):
        v = last.booked_at.isoformat()
    elif sort_by == "abs_amount_desc":
        v = str(abs(last.amount))
    else:
        v = str(last.amount)
    return _encode_cursor(v, str(last.id))


def _apply_filters(
    query,
    *,
    account_uuid=None,
    account_uuids=None,
    category_uuid=None,
    category_uuids=None,
    from_dt=None,
    to_dt=None,
    uncategorized: bool = False,
    category_type=None,
    min_amount=None,
    max_amount=None,
    merchant=None,
):
    """The filters `list_transactions` and `search_transactions` share.

    One definition, because the two tools drifted: a `category_id` that
    matched the AI assignment in one and only the user override in the other
    is two different answers to the same question.

    Singular and plural forms of the id filters are both accepted and mean
    the same thing; the plural is the one to use, and the singular stays for
    one release.
    """
    ids = _merge_ids(account_uuid, account_uuids)
    if ids:
        query = query.filter(Transaction.account_id.in_(ids))

    category_ids = _merge_ids(category_uuid, category_uuids)
    if category_ids:
        # The effective category: the user override when set, the AI
        # assignment otherwise. Matching only `category_id` would miss every
        # transaction the user has never corrected.
        query = query.filter(
            Transaction.category_id.in_(category_ids)
            | and_(
                Transaction.category_id.is_(None),
                Transaction.category_system_id.in_(category_ids),
            )
        )

    if uncategorized:
        query = query.filter(
            Transaction.category_id.is_(None),
            Transaction.category_system_id.is_(None),
        )

    if category_type:
        query = query.join(
            Category,
            Category.id == func.coalesce(Transaction.category_id, Transaction.category_system_id),
        ).filter(Category.category_type == category_type)

    if from_dt:
        query = query.filter(Transaction.booked_at >= from_dt)
    if to_dt:
        # Exclusive: require_date_bound advanced a bare date to the next
        # midnight so the named day is included in full.
        query = query.filter(Transaction.booked_at < to_dt)

    # Amount bounds are on the magnitude, so "over 100" means the same thing
    # for a 100 euro expense and a 100 euro salary. Asking for signed bounds
    # would make every expense query need a negative max and a -inf min.
    if min_amount is not None:
        query = query.filter(func.abs(Transaction.amount) >= abs(min_amount))
    if max_amount is not None:
        query = query.filter(func.abs(Transaction.amount) <= abs(max_amount))

    if merchant:
        # Exact, case-insensitive. The fuzzy version is what
        # search_transactions(queries=...) is for; this one is for pivoting
        # off a name get_top_merchants just handed you.
        query = query.filter(func.lower(Transaction.merchant) == merchant.strip().lower())

    return query


def _merge_ids(singular, plural) -> list:
    """Accept the singular alias and the plural filter as one list."""
    ids = list(plural or [])
    if singular is not None and singular not in ids:
        ids.append(singular)
    return ids


def list_transactions(
    user_id: str,
    account_id: Optional[str] = None,
    category_id: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = 50,
    page: int = 1,
    cursor: Optional[str] = None,
    sort_by: SortBy = "booked_at_desc",
    uncategorized: bool = False,
    category_type: Optional[Literal["expense", "income", "transfer"]] = None,
    account_ids: Optional[list[str]] = None,
    category_ids: Optional[list[str]] = None,
    min_amount: Optional[float] = None,
    max_amount: Optional[float] = None,
    merchant: Optional[str] = None,
) -> dict:
    """
    List transactions with optional filtering, cursor pagination, and sort.

    Args:
        user_id: The user's ID
        account_id: Filter by one account ID (alias for account_ids=[...])
        category_id: Filter by one category ID (alias for category_ids=[...])
        account_ids: Filter to any of these accounts (optional)
        category_ids: Filter to any of these categories, matched on the
            effective category (user override, else AI assignment) (optional)
        from_date: Start date, inclusive (optional)
        to_date: End date, inclusive (optional)
        min_amount: Minimum absolute amount, so 50 means "50 or more" for
            both an expense and an income row (optional)
        max_amount: Maximum absolute amount (optional)
        merchant: Exact merchant name, case-insensitive. For fuzzy matching
            use search_transactions(queries=[...]) (optional)
        search: DEPRECATED substring match on description/merchant. Use
            search_transactions, which offers match modes and does not
            silently match substrings of longer words.
        limit: Max results per page (default: 50, max: 100)
        page: Page number (default: 1) - ignored when cursor is provided
        cursor: Opaque pagination cursor (preferred over page)
        sort_by: Sort order - one of booked_at_desc (default),
            booked_at_asc, amount_desc, amount_asc, abs_amount_desc
        uncategorized: If True, return only transactions with no category
        category_type: Filter by resolved category type
            (expense, income, transfer)

    Returns:
        Dict with:
        - transactions: list of transaction dicts
        - page: current page (None when cursor-paginated)
        - limit: effective page size
        - next_cursor: opaque cursor for the next page (None when exhausted)
    """
    page = max(1, page)
    limit = min(max(1, limit), 100)
    account_uuid = require_uuid(account_id, "account_id")
    category_uuid = require_uuid(category_id, "category_id")
    account_uuids = require_uuid_list(account_ids, "account_ids")
    category_uuids = require_uuid_list(category_ids, "category_ids")
    from_dt = require_date_bound(from_date, "from_date")
    to_dt = require_date_bound(to_date, "to_date", end=True)

    with get_db() as db:
        query = (
            db.query(Transaction)
            .filter(Transaction.user_id == user_id)
            .options(joinedload(Transaction.account), joinedload(Transaction.category))
        )
        query = _apply_filters(
            query,
            account_uuid=account_uuid,
            account_uuids=account_uuids,
            category_uuid=category_uuid,
            category_uuids=category_uuids,
            from_dt=from_dt,
            to_dt=to_dt,
            uncategorized=uncategorized,
            category_type=category_type,
            min_amount=min_amount,
            max_amount=max_amount,
            merchant=merchant,
        )
        if search:
            search_term = f"%{search[:500]}%"
            query = query.filter(
                or_(
                    Transaction.description.ilike(search_term),
                    Transaction.merchant.ilike(search_term),
                )
            )

        if cursor:
            paginated = _paginate_query(query, cursor, sort_by, limit)
        else:
            offset = (page - 1) * limit
            primary_col, direction = _sort_expr(sort_by)
            paginated = (
                query.order_by(direction(primary_col), direction(Transaction.id))
                .offset(offset)
                .limit(limit)
            )
        transactions_rows = paginated.all()
        next_cursor = _build_next_cursor(transactions_rows, sort_by, limit)

        return {
            "transactions": [
                {
                    "id": str(txn.id),
                    "account_id": str(txn.account_id),
                    "account_name": txn.account.name if txn.account else None,
                    "amount": float(txn.amount),
                    "currency": txn.currency,
                    "description": txn.description,
                    "merchant": txn.merchant,
                    "category_id": str(txn.category_id) if txn.category_id else None,
                    "category_system_id": str(txn.category_system_id)
                    if txn.category_system_id
                    else None,
                    "category_name": txn.category.name if txn.category else None,
                    "booked_at": txn.booked_at.isoformat() if txn.booked_at else None,
                    "pending": txn.pending,
                    "transaction_type": txn.transaction_type,
                    "include_in_analytics": txn.include_in_analytics,
                    "recurring_transaction_id": str(txn.recurring_transaction_id)
                    if txn.recurring_transaction_id
                    else None,
                }
                for txn in transactions_rows
            ],
            "page": page if not cursor else None,
            "limit": limit,
            "next_cursor": next_cursor,
        }


def get_transaction(user_id: str, transaction_id: str) -> dict | None:
    """
    Get a single transaction by ID.

    Args:
        user_id: The user's ID
        transaction_id: The transaction's ID

    Returns:
        Transaction dictionary or None if not found
    """
    txn_uuid = validate_uuid(transaction_id)
    if not txn_uuid:
        return None

    with get_db() as db:
        txn = (
            db.query(Transaction)
            .filter(Transaction.id == txn_uuid, Transaction.user_id == user_id)
            .options(joinedload(Transaction.account), joinedload(Transaction.category))
            .first()
        )

        if not txn:
            return None

        return {
            "id": str(txn.id),
            "account_id": str(txn.account_id),
            "account_name": txn.account.name if txn.account else None,
            "external_id": txn.external_id,
            "transaction_type": txn.transaction_type,
            "amount": float(txn.amount),
            "currency": txn.currency,
            "functional_amount": float(txn.functional_amount) if txn.functional_amount else None,
            "description": txn.description,
            "merchant": txn.merchant,
            "category_id": str(txn.category_id) if txn.category_id else None,
            "category_system_id": str(txn.category_system_id) if txn.category_system_id else None,
            "category_name": txn.category.name if txn.category else None,
            "booked_at": txn.booked_at.isoformat() if txn.booked_at else None,
            "pending": txn.pending,
            "categorization_instructions": txn.categorization_instructions,
            "enrichment_data": txn.enrichment_data,
            "include_in_analytics": txn.include_in_analytics,
            "recurring_transaction_id": str(txn.recurring_transaction_id)
            if txn.recurring_transaction_id
            else None,
            "created_at": txn.created_at.isoformat() if txn.created_at else None,
            "updated_at": txn.updated_at.isoformat() if txn.updated_at else None,
        }


# Regex metacharacters, escaped so a search term is always matched literally.
# Without this a query like "(a+)+b" would be compiled as a pattern: wrong
# results at best, and catastrophic backtracking inside Postgres at worst.
_REGEX_METACHARS = frozenset(r"\.^$*+?()[]{}|")


def escape_regex(value: str) -> str:
    """Escape `value` so Postgres matches it as a literal string."""
    return "".join("\\" + ch if ch in _REGEX_METACHARS else ch for ch in value)


def _build_search_filter(query_str: str, match_mode: MatchMode):
    """
    Build SQLAlchemy filter based on match mode.

    Args:
        query_str: The search query string
        match_mode: How to match - "contains", "starts_with", or "word"

    Returns:
        SQLAlchemy filter expression
    """
    if match_mode == "starts_with":
        pattern = f"{query_str}%"
        return or_(
            Transaction.description.ilike(pattern),
            Transaction.merchant.ilike(pattern),
        )
    elif match_mode == "word":
        # `\y` is Postgres' word-boundary assertion, so a single case-insensitive
        # regex replaces the sixteen ILIKE patterns this used to emit. It is also
        # more correct: the old version enumerated a handful of delimiters
        # (space, comma, period), so "Action" missed "Action-Store" and
        # "(Action)". `\y` treats every non-word character as a boundary.
        pattern = rf"\y{escape_regex(query_str)}\y"
        return or_(
            Transaction.description.op("~*")(pattern),
            Transaction.merchant.op("~*")(pattern),
        )
    else:  # contains (default)
        pattern = f"%{query_str}%"
        return or_(
            Transaction.description.ilike(pattern),
            Transaction.merchant.ilike(pattern),
        )


def search_transactions(
    user_id: str,
    query: Optional[str] = None,
    queries: Optional[list[str]] = None,
    exclude_category_id: Optional[str] = None,
    match_mode: MatchMode = "contains",
    ids_only: bool = False,
    limit: int = 50,
    page: int = 1,
    cursor: Optional[str] = None,
    sort_by: SortBy = "booked_at_desc",
    account_id: Optional[str] = None,
    account_ids: Optional[list[str]] = None,
    category_ids: Optional[list[str]] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    min_amount: Optional[float] = None,
    max_amount: Optional[float] = None,
    merchant: Optional[str] = None,
) -> dict:
    """
    Find transactions by text, with filters. Use this for anything fuzzy.

    For an exact merchant name or a plain filter with no text at all, the
    filter arguments below do it without a search term. For a category
    breakdown rather than rows, use get_amounts_by_category.

    ⚠️ PAGINATION: Check `has_more` in the response! If true, call again with
    page=2, page=3, etc. until has_more=false to get all results.
    Prefer `cursor`/`next_cursor` for stable pagination over large result sets.

    Args:
        user_id: The user's ID
        query: One search string (case-insensitive)
        queries: Several search strings; a transaction matching ANY of them is
            returned. One call instead of N, which is what makes a bulk
            recategorization affordable. `query` and `queries` combine.
        exclude_category_id: Exclude transactions already in this category (optional)
        match_mode: How to match the query:
            - "contains": Substring match (default) - "Action" matches "Transaction"
            - "starts_with": Must start with query - "Action" won't match "Transaction"
            - "word": Word boundary match - "Action" matches "Action Store" but not "Transaction"
        ids_only: If True, return only transaction IDs (faster for bulk operations)
        limit: Max results per page (default: 50, max: 100)
        page: Page number (default: 1) - ignored when cursor is provided
        cursor: Opaque pagination cursor (preferred over page)
        sort_by: Sort order - one of booked_at_desc (default),
            booked_at_asc, amount_desc, amount_asc, abs_amount_desc
        account_id: Filter to one account (alias for account_ids=[...])
        account_ids: Filter to any of these accounts (optional)
        category_ids: Filter to any of these categories, matched on the
            effective category (user override, else AI assignment) (optional)
        from_date: Start date, inclusive (optional)
        to_date: End date, inclusive (optional)
        min_amount: Minimum absolute amount (optional)
        max_amount: Maximum absolute amount (optional)
        merchant: Exact merchant name, case-insensitive (optional)

    Returns:
        Dict with:
        - transactions: List of matching transactions (or transaction_ids if ids_only=True)
        - query_counts: Per-query match counts, when `queries` was used
        - page: Current page number (None when cursor-paginated)
        - limit: Results per page
        - has_more: Boolean - if true, more results exist
        - total_count: Total matches across all pages. None while paging
          by cursor, where `has_more` comes from `next_cursor` instead
          and the count would re-scan on every page.
        - next_cursor: Opaque cursor for the next page (None when exhausted)
    """
    page = max(1, page)
    limit = min(max(1, limit), 100)

    # `query` and `queries` are the same argument with different arity. Both
    # are accepted and combined rather than one being rejected in favour of
    # the other, because the single-term spelling is what a caller reaches
    # for first and there is no reason to make it wrong.
    # Search strings are capped to keep one pathological argument from
    # building a pathological LIKE.
    terms = [t[:500] for t in ([query] if query else []) + list(queries or []) if t]

    # Validate IDs if provided
    exclude_cat_uuid = require_uuid(exclude_category_id, "exclude_category_id")
    account_uuid = require_uuid(account_id, "account_id")
    account_uuids = require_uuid_list(account_ids, "account_ids")
    category_uuids = require_uuid_list(category_ids, "category_ids")
    from_dt = require_date_bound(from_date, "from_date")
    to_dt = require_date_bound(to_date, "to_date", end=True)

    has_filter = any(
        v is not None
        for v in (
            account_id,
            account_ids,
            category_ids,
            from_date,
            to_date,
            min_amount,
            max_amount,
            merchant,
        )
    )
    if not terms and not has_filter:
        raise missing_argument(
            "query or queries",
            "give a search string, or a filter such as merchant/category_ids/from_date",
        )

    with get_db() as db:
        # A transaction matching ANY term qualifies; no terms means the
        # filters alone decide.
        base_filter = Transaction.user_id == user_id
        if terms:
            base_filter = and_(
                base_filter, or_(*[_build_search_filter(t, match_mode) for t in terms])
            )

        # Add category exclusion if specified
        if exclude_cat_uuid:
            base_filter = and_(
                base_filter,
                or_(Transaction.category_id != exclude_cat_uuid, Transaction.category_id.is_(None)),
            )

        query_obj = _apply_filters(
            db.query(Transaction).filter(base_filter),
            account_uuid=account_uuid,
            account_uuids=account_uuids,
            category_uuids=category_uuids,
            from_dt=from_dt,
            to_dt=to_dt,
            min_amount=min_amount,
            max_amount=max_amount,
            merchant=merchant,
        )

        # Paging by cursor derives `has_more` from whether a next cursor
        # exists, so the total is only worth its scan on the first request.
        total_count = None if cursor else query_obj.count()

        # Per-term counts, so a caller who searched five merchant spellings
        # can see which ones actually matched anything.
        query_counts = (
            {
                t: _apply_filters(
                    db.query(Transaction).filter(
                        and_(Transaction.user_id == user_id, _build_search_filter(t, match_mode))
                    ),
                    account_uuid=account_uuid,
                    account_uuids=account_uuids,
                    category_uuids=category_uuids,
                    from_dt=from_dt,
                    to_dt=to_dt,
                    min_amount=min_amount,
                    max_amount=max_amount,
                    merchant=merchant,
                ).count()
                for t in terms
            }
            if queries and not cursor
            else None
        )

        # Only load relationships if we need full data
        if not ids_only:
            query_obj = query_obj.options(
                joinedload(Transaction.account), joinedload(Transaction.category)
            )

        # Apply cursor or offset pagination
        if cursor:
            paginated = _paginate_query(query_obj, cursor, sort_by, limit)
        else:
            offset = (page - 1) * limit
            primary_col, direction = _sort_expr(sort_by)
            paginated = (
                query_obj.order_by(direction(primary_col), direction(Transaction.id))
                .offset(offset)
                .limit(limit)
            )

        rows = paginated.all()
        next_cursor = _build_next_cursor(rows, sort_by, limit)
        has_more = (
            next_cursor is not None if cursor else ((page - 1) * limit + len(rows) < total_count)
        )

        envelope = {
            "page": page if not cursor else None,
            "limit": limit,
            "has_more": has_more,
            "total_count": total_count,
            "next_cursor": next_cursor,
        }
        if query_counts is not None:
            envelope["query_counts"] = query_counts

        if ids_only:
            return {"transaction_ids": [str(t.id) for t in rows], **envelope}

        return {
            "transactions": [
                {
                    "id": str(txn.id),
                    "account_id": str(txn.account_id),
                    "account_name": txn.account.name if txn.account else None,
                    "amount": float(txn.amount),
                    "currency": txn.currency,
                    "description": txn.description,
                    "merchant": txn.merchant,
                    "category_id": str(txn.category_id) if txn.category_id else None,
                    "category_name": txn.category.name if txn.category else None,
                    "booked_at": txn.booked_at.isoformat() if txn.booked_at else None,
                }
                for txn in rows
            ],
            **envelope,
        }


def search_transactions_multi(
    user_id: str,
    queries: list[str],
    exclude_category_id: Optional[str] = None,
    match_mode: MatchMode = "contains",
    ids_only: bool = False,
    max_results: int = 500,
    cursor: Optional[str] = None,
    sort_by: SortBy = "booked_at_desc",
    account_id: Optional[str] = None,
) -> dict:
    """DEPRECATED -- use search_transactions(queries=[...]).

    The two tools were the same search with different arity, which meant a
    caller had to know both before it could pick one, and every filter added
    to one had to be added to the other or the two would disagree.
    `search_transactions` now takes `queries`.

    Kept for one release. `max_results` maps onto `limit`, which caps at 100
    per page -- page through with `cursor` for more.
    """
    if not queries:
        raise missing_argument("queries", "at least one search string is required")

    return search_transactions(
        user_id,
        queries=queries,
        exclude_category_id=exclude_category_id,
        match_mode=match_mode,
        ids_only=ids_only,
        limit=min(max(1, max_results), 100),
        cursor=cursor,
        sort_by=sort_by,
        account_id=account_id,
    )


def update_transaction_category(
    user_id: str,
    transaction_id: str,
    category_id: str,
    dry_run: bool = False,
) -> dict:
    """
    Update the category of a transaction (user override).

    This sets the user-defined category (category_id), which takes precedence
    over the AI-assigned category (category_system_id).

    Args:
        user_id: The user's ID
        transaction_id: The transaction's ID
        category_id: The new category ID to assign
        dry_run: Preview the change without committing it (default False)

    Returns:
        Dict with `changed`, `before`, `after`, `fields_changed` and the
        serialized `transaction`. `changed` is False when the transaction was
        already in that category. Raises ToolError on invalid input or an
        unknown transaction_id/category_id.
    """
    # Both ids are write targets, so a malformed one raises rather than
    # collapsing into "not found" -- the caller needs to know which it was.
    txn_uuid = require_uuid(transaction_id, "transaction_id")
    cat_uuid = require_uuid(category_id, "category_id")

    with get_db() as db:
        # Verify transaction belongs to user
        txn = (
            db.query(Transaction)
            .filter(Transaction.id == txn_uuid, Transaction.user_id == user_id)
            .first()
        )

        if not txn:
            # No candidate list here: a user has tens of thousands of
            # transactions, so naming twenty of them is noise.
            raise not_found("transaction", transaction_id, tool="search_transactions")

        # Verify category belongs to user
        category = (
            db.query(Category).filter(Category.id == cat_uuid, Category.user_id == user_id).first()
        )

        if not category:
            raise not_found(
                "category",
                category_id,
                candidates=_category_candidates(db, user_id),
                tool="list_categories",
            )

        # `category_id` is the user override; `category_system_id` is the AI
        # assignment it takes precedence over. Both are snapshotted because
        # the effective category depends on the pair, and a caller reading
        # only the override cannot tell whether this call changed anything.
        tracked = ("category_id", "category_system_id")
        before = snapshot(txn, tracked)

        try:
            txn.category_id = cat_uuid

            return preview_or_commit(
                db,
                dry_run,
                lambda: mutation_result(
                    before,
                    snapshot(txn, tracked),
                    transaction={
                        "id": str(txn.id),
                        "category_id": str(txn.category_id),
                        "category_name": category.name,
                        "description": txn.description,
                        "merchant": txn.merchant,
                        "amount": float(txn.amount),
                        "currency": txn.currency,
                    },
                ),
            )
        except Exception as e:
            db.rollback()
            raise_database_error("update_transaction_category", e)


def bulk_update_transaction_categories(
    user_id: str,
    category_id: str,
    transaction_ids: list[str],
    dry_run: bool = False,
) -> dict:
    """
    Bulk update category for multiple transactions.

    Args:
        user_id: The user's ID
        category_id: The category ID to assign
        transaction_ids: List of transaction IDs to update (max 2000)
        dry_run: If True, preview the change without committing

    Returns:
        Dict with:
        - updated_count (or would_update_count if dry_run)
        - requested_count, invalid_ids, not_found_ids,
          skipped_already_in_category_ids
        - sample_changes: up to 10 rows, each with `before` and `after`
        - dry_run, committed
    """
    MAX_IDS = 2000
    if not transaction_ids:
        raise missing_argument("transaction_ids", "at least one transaction id is required")
    if len(transaction_ids) > MAX_IDS:
        raise out_of_range("transaction_ids length", len(transaction_ids), maximum=MAX_IDS)

    cat_uuid = require_uuid(category_id, "category_id")

    with get_db() as db:
        # Verify category belongs to user
        category = (
            db.query(Category)
            .filter(
                Category.id == cat_uuid,
                Category.user_id == user_id,
            )
            .first()
        )

        if not category:
            raise not_found(
                "category",
                category_id,
                candidates=_category_candidates(db, user_id),
                tool="list_categories",
            )

        valid_uuids = []
        invalid_ids = []
        for tid in transaction_ids:
            u = validate_uuid(tid)
            if u:
                valid_uuids.append(u)
            else:
                invalid_ids.append(tid)

        found = (
            (
                db.query(Transaction)
                .filter(
                    Transaction.user_id == user_id,
                    Transaction.id.in_(valid_uuids),
                )
                .options(joinedload(Transaction.category))
                .all()
            )
            if valid_uuids
            else []
        )

        found_by_id = {str(t.id): t for t in found}
        not_found_ids = [str(u) for u in valid_uuids if str(u) not in found_by_id]

        to_change = []
        skipped_already = []
        for t in found:
            if t.category_id == cat_uuid:
                skipped_already.append(str(t.id))
            else:
                to_change.append(t)

        # Same before/after shape the single-entity writes use, so an agent
        # rendering a preview does not need a second code path for bulk.
        sample_changes = [
            {
                "id": str(t.id),
                "description": t.description,
                "merchant": t.merchant,
                "amount": float(t.amount),
                "currency": t.currency,
                "before": {
                    "category_id": str(t.category_id) if t.category_id else None,
                    "category_name": t.category.name if t.category else None,
                },
                "after": {"category_id": str(cat_uuid), "category_name": category.name},
            }
            for t in sorted(to_change, key=lambda t: (t.booked_at, t.id))[:10]
        ]

        base_response = {
            "category_name": category.name,
            "requested_count": len(transaction_ids),
            "invalid_ids": invalid_ids,
            "not_found_ids": not_found_ids,
            "skipped_already_in_category_ids": skipped_already,
            "sample_changes": sample_changes,
        }

        try:
            # The update runs either way and `preview_or_commit` decides
            # whether it survives. Previewing by *not* writing would skip
            # every constraint the database enforces, which is most of what
            # a preview is for.
            change_uuids = [t.id for t in to_change]
            updated = 0
            if change_uuids:
                updated = (
                    db.query(Transaction)
                    .filter(
                        Transaction.user_id == user_id,
                        Transaction.id.in_(change_uuids),
                    )
                    .update({Transaction.category_id: cat_uuid}, synchronize_session=False)
                )

            count_key = "would_update_count" if dry_run else "updated_count"
            return preview_or_commit(db, dry_run, lambda: {**base_response, count_key: updated})
        except Exception as e:
            db.rollback()
            raise_database_error("bulk_update_transaction_categories", e)
