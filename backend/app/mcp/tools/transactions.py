"""
Transaction tools for the MCP server.
"""

from __future__ import annotations

import base64
import json
from contextlib import contextmanager
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional, Literal

from fastmcp.exceptions import ToolError
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
    invalid_enum,
    invalid_format,
    missing_argument,
    not_found,
    out_of_range,
    raise_database_error,
)
from app.mcp.tools._writes import (
    mutation_result,
    preview_or_commit,
    preview_session,
    remember,
    replay,
    snapshot,
)
from app.models import Account, Transaction, Category
from app.services.transaction_mutation_service import TransactionMutationService


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

        return _serialize_transaction(txn)


def _serialize_transaction(txn: Transaction) -> dict:
    """The full shape of one transaction, as `get_transaction` returns it.

    Shared with the write tools so that what an agent reads back after a
    create or an edit is field-for-field what it would have read from
    `get_transaction`, rather than a second, subtly shorter rendering it has
    to learn separately.
    """
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


# ---------------------------------------------------------------------------
# Writes that move money
# ---------------------------------------------------------------------------
#
# These go through TransactionMutationService rather than inserting rows
# directly, because a transaction is not just a row: it sets the account's
# balance and every daily balance snapshot from its date forward. The service
# is what the app's own edit screen drives, so a transaction an agent books
# is indistinguishable from one the user typed in -- and one written without
# it would be a row the user cannot find in their balance.


# `debit`/`credit` is the ledger's vocabulary and every read tool speaks it,
# but "expense"/"income" is what a caller means. Accepting both costs one
# dict and saves a rejected call that gets retried with a guess.
_DIRECTIONS = {
    "debit": "debit",
    "expense": "debit",
    "credit": "credit",
    "income": "credit",
}

# Enough for "delete this month's duplicates", short of a call that would
# rewrite a year of balance snapshots before anyone could look at a preview.
MAX_DELETE_IDS = 500


@contextmanager
def _session(dry_run: bool):
    """A normal session, or one whose writes are undone on exit.

    TransactionMutationService commits internally -- it has to, because the
    balance recalculation reads back the rows the mutation just wrote. So a
    preview cannot be built by withholding the commit the way
    `preview_or_commit` does; the write has already landed by the time
    control returns. `preview_session` rolls back the transaction the
    service committed into instead, which keeps the service path byte-for-
    byte identical between a previewed call and a real one.
    """
    if dry_run:
        with preview_session() as db:
            yield db
    else:
        with get_db() as db:
            yield db


def _remember(user_id: str, tool: str, key: str | None, digest: str | None, response: dict) -> None:
    """Store the response against its key, in a session of its own.

    The write's session has already closed by this point on a real call, and
    on a previewed one it was never going to be committed. Deliberately
    after the write: if this fails the write still stands, and a retry
    writes again -- which is what no key at all would have done.
    """
    if not key or digest is None:
        return
    with get_db() as db:
        remember(db, user_id, tool, key, digest, response)


def _account_candidates(db, user_id: str) -> list[tuple[str, str]]:
    """(name, id) pairs for a not_found message, from the caller's session."""
    return [
        (name, str(aid))
        for aid, name in db.query(Account.id, Account.name)
        .filter(Account.user_id == user_id)
        .order_by(Account.name)
        .all()
    ]


def _require_direction(value: str, param: str = "transaction_type") -> str:
    direction = _DIRECTIONS.get((value or "").strip().lower())
    if direction is None:
        raise invalid_enum(param, value, tuple(_DIRECTIONS))
    return direction


def _require_positive_amount(amount: float, param: str = "amount") -> Decimal:
    """Amounts arrive as magnitudes; the sign comes from the direction.

    A caller that passes -20 for an expense means the same thing as one that
    passes 20, but the two spellings cannot both be honoured: negating a
    negative would book income. Refusing is the only reading that cannot
    silently invert a row.
    """
    if amount is None:
        raise missing_argument(param, "an amount is required")
    if amount <= 0:
        raise invalid_format(
            param,
            amount,
            "a positive amount",
            example="12.50",
            hint="The direction comes from transaction_type, not from the sign.",
        )
    return Decimal(str(amount)).quantize(Decimal("0.01"))


def _write_booked_at(value: Optional[str], param: str = "booked_at") -> datetime:
    """Parse the date a transaction is booked on, defaulting to today.

    Midnight UTC when only a date is given, matching how bank rows and
    generated recurring occurrences land, so a manually added expense sorts
    among them rather than always after them.
    """
    if value is None:
        return datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    try:
        parsed = datetime.fromisoformat(value.strip())
    except (AttributeError, TypeError, ValueError):
        raise invalid_format(
            param,
            value,
            "an ISO-8601 date (YYYY-MM-DD) or timestamp",
            example="2026-09-19",
        ) from None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _require_owned_account(db, user_id: str, account_id: str, param: str = "account_id"):
    account_uuid = require_uuid(account_id, param)
    account = (
        db.query(Account).filter(Account.id == account_uuid, Account.user_id == user_id).first()
    )
    if not account:
        raise not_found(
            "account",
            account_id,
            candidates=_account_candidates(db, user_id),
            tool="list_accounts",
        )
    return account


def _require_owned_category(db, user_id: str, category_id: str):
    category_uuid = require_uuid(category_id, "category_id")
    category = (
        db.query(Category).filter(Category.id == category_uuid, Category.user_id == user_id).first()
    )
    if not category:
        raise not_found(
            "category",
            category_id,
            candidates=_category_candidates(db, user_id),
            tool="list_categories",
        )
    return category


def create_transaction(
    user_id: str,
    account_id: str,
    amount: float,
    description: str,
    transaction_type: str = "debit",
    booked_at: Optional[str] = None,
    merchant: Optional[str] = None,
    category_id: Optional[str] = None,
    include_in_analytics: bool = True,
    dry_run: bool = False,
    idempotency_key: Optional[str] = None,
) -> dict:
    """
    Record one expense or income transaction.

    Args:
        user_id: The user's ID
        account_id: The account it lands on, from list_accounts()
        amount: A positive magnitude. The sign comes from
            `transaction_type`, never from this number.
        description: What it was. Required -- it is what the user will read
            in their ledger, and what categorization matches on later.
        transaction_type: "debit"/"expense" (money out, the default) or
            "credit"/"income" (money in)
        booked_at: YYYY-MM-DD, or an ISO timestamp. Defaults to today.
        merchant: Who was paid, or who paid (optional)
        category_id: Category from list_categories() (optional). Left unset
            the transaction is uncategorized; nothing categorizes it later
            on its own.
        include_in_analytics: False excludes it from spending charts and
            KPIs. For a movement between the user's own accounts use
            create_transfer instead, which books both sides.
        dry_run: Book it, report it, then roll it back (default False)
        idempotency_key: Caller-chosen id making a retry safe. Without one,
            a retry after a lost response books the expense twice.

    Returns:
        {"transaction": {...}, "dry_run": bool, "committed": bool}. The
        transaction carries its `functional_amount` and the account balance
        is recalculated from its date forward. Raises ToolError on invalid
        input or an unknown account_id/category_id.
    """
    if not description or not description.strip():
        raise missing_argument("description", "a transaction needs a non-empty description")
    direction = _require_direction(transaction_type)
    money = _require_positive_amount(amount)
    when = _write_booked_at(booked_at)

    arguments = {
        "account_id": account_id,
        "amount": amount,
        "description": description,
        "transaction_type": direction,
        "booked_at": booked_at,
        "merchant": merchant,
        "category_id": category_id,
        "include_in_analytics": include_in_analytics,
    }

    with _session(dry_run) as db:
        # A dry run takes no key: it is a question, not a call to remember.
        stored, digest = replay(
            db, user_id, "create_transaction", None if dry_run else idempotency_key, arguments
        )
        if stored is not None:
            return stored

        account = _require_owned_account(db, user_id, account_id)
        category = _require_owned_category(db, user_id, category_id) if category_id else None

        try:
            txn = TransactionMutationService(db, user_id).create_transaction(
                account_id=account.id,
                amount=money,
                transaction_type=direction,
                booked_at=when,
                description=description,
                merchant=merchant,
                category_id=category.id if category else None,
                include_in_analytics=include_in_analytics,
            )
            response = {
                "transaction": _serialize_transaction(txn),
                "dry_run": dry_run,
                "committed": not dry_run,
            }
        except ValueError as e:
            db.rollback()
            raise ToolError(str(e)) from None
        except Exception as e:  # noqa: BLE001
            db.rollback()
            raise_database_error("create_transaction", e)

    if not dry_run:
        _remember(user_id, "create_transaction", idempotency_key, digest, response)
    return response


def update_transaction(
    user_id: str,
    transaction_id: str,
    amount: Optional[float] = None,
    transaction_type: Optional[str] = None,
    booked_at: Optional[str] = None,
    description: Optional[str] = None,
    merchant: Optional[str] = None,
    account_id: Optional[str] = None,
    category_id: Optional[str] = None,
    include_in_analytics: Optional[bool] = None,
    dry_run: bool = False,
    idempotency_key: Optional[str] = None,
) -> dict:
    """
    Edit a transaction. Omitted fields keep their current value.

    Changing the amount, type, date or account re-derives the currency
    conversion and recalculates the account's balance from the earlier of
    the old and new date -- both accounts, when it moves between them. The
    other fields are a plain patch.

    To change only the category, update_transaction_category is the smaller
    call; this one accepts it too.

    Args:
        user_id: The user's ID
        transaction_id: The transaction's ID
        amount: New positive magnitude; the sign follows the type (optional)
        transaction_type: "debit"/"expense" or "credit"/"income" (optional)
        booked_at: New YYYY-MM-DD or ISO timestamp (optional)
        description: New description. Cannot be blanked (optional)
        merchant: New merchant, or "" to clear it (optional)
        account_id: Move it to another account (optional)
        category_id: New category, or "" to clear it (optional)
        include_in_analytics: Whether it counts toward spending charts and
            KPIs (optional)
        dry_run: Apply it, report it, then roll it back (default False)
        idempotency_key: Caller-chosen id making a retry safe

    Returns:
        {"changed", "before", "after", "fields_changed", "transaction",
        "dry_run", "committed"}. `changed` is False when the values were
        already what was asked for. Raises ToolError when the transaction is
        one side of an internal transfer or a balancing entry -- those are
        edited by unlinking them first.
    """
    txn_uuid = require_uuid(transaction_id, "transaction_id")

    updates: dict = {}
    if amount is not None:
        updates["amount"] = _require_positive_amount(amount)
    if transaction_type is not None:
        updates["transaction_type"] = _require_direction(transaction_type)
    if booked_at is not None:
        updates["booked_at"] = _write_booked_at(booked_at)
    if description is not None:
        updates["description"] = description
    if merchant is not None:
        updates["merchant"] = merchant.strip() or None
    if include_in_analytics is not None:
        updates["include_in_analytics"] = include_in_analytics
    if not updates and account_id is None and category_id is None:
        raise missing_argument(
            "fields", "at least one field to change (amount, description, category_id, ...)"
        )

    arguments = {
        "transaction_id": transaction_id,
        "amount": amount,
        "transaction_type": transaction_type,
        "booked_at": booked_at,
        "description": description,
        "merchant": merchant,
        "account_id": account_id,
        "category_id": category_id,
        "include_in_analytics": include_in_analytics,
    }

    # What a caller needs to see to know what this call did. `currency` and
    # `functional_amount` are in here because they are derived rather than
    # passed: moving a transaction to an account in another currency
    # re-denominates it, and a caller that only sees `amount` reads that as
    # no change at all.
    tracked = (
        "account_id",
        "amount",
        "currency",
        "functional_amount",
        "transaction_type",
        "booked_at",
        "description",
        "merchant",
        "category_id",
        "include_in_analytics",
    )

    with _session(dry_run) as db:
        stored, digest = replay(
            db, user_id, "update_transaction", None if dry_run else idempotency_key, arguments
        )
        if stored is not None:
            return stored

        txn = (
            db.query(Transaction)
            .filter(Transaction.id == txn_uuid, Transaction.user_id == user_id)
            .first()
        )
        if not txn:
            raise not_found("transaction", transaction_id, tool="search_transactions")

        if account_id is not None:
            updates["account_id"] = _require_owned_account(db, user_id, account_id).id
        if category_id is not None:
            # "" clears the override; any other value has to name a real
            # category of this user's.
            updates["category_id"] = (
                _require_owned_category(db, user_id, category_id).id if category_id else None
            )

        before = snapshot(txn, tracked)

        try:
            updated = TransactionMutationService(db, user_id).update_transaction(txn_uuid, updates)
            response = mutation_result(
                before,
                snapshot(updated, tracked),
                transaction=_serialize_transaction(updated),
                dry_run=dry_run,
                committed=not dry_run,
            )
        except LookupError as e:
            db.rollback()
            raise ToolError(str(e)) from None
        except ValueError as e:
            db.rollback()
            raise ToolError(str(e)) from None
        except Exception as e:  # noqa: BLE001
            db.rollback()
            raise_database_error("update_transaction", e)

    if not dry_run:
        _remember(user_id, "update_transaction", idempotency_key, digest, response)
    return response


def delete_transactions(
    user_id: str,
    transaction_ids: list[str],
    dry_run: bool = False,
    idempotency_key: Optional[str] = None,
) -> dict:
    """
    Permanently delete transactions and recalculate the balances they moved.

    Both sides of an internal transfer go together: deleting one side alone
    would leave the other as unexplained income or spending, so naming
    either one deletes the pair. `deleted_count` can therefore exceed the
    number of ids passed, and `account_impacts` says what each account's
    balance becomes.

    There is no undo. Preview with dry_run first and show the user the rows.

    Args:
        user_id: The user's ID
        transaction_ids: The transactions to delete (max 500)
        dry_run: Report what would be destroyed without destroying it
            (default False)
        idempotency_key: Caller-chosen id making a retry safe

    Returns:
        {"deleted_count", "requested_count", "not_found_ids",
        "deleted_transactions" (up to 20), "linked_transfer_ids",
        "account_impacts", "dry_run", "committed"}
    """
    if not transaction_ids:
        raise missing_argument("transaction_ids", "at least one transaction id is required")
    if len(transaction_ids) > MAX_DELETE_IDS:
        raise out_of_range("transaction_ids length", len(transaction_ids), maximum=MAX_DELETE_IDS)

    # Write targets, so a malformed id raises rather than being quietly
    # dropped from the set: a delete that silently skips one of its rows is
    # the one mistake the caller cannot see in the result.
    uuids = [require_uuid(tid, "transaction_ids") for tid in transaction_ids]
    arguments = {"transaction_ids": [str(u) for u in uuids]}

    with _session(dry_run) as db:
        stored, digest = replay(
            db, user_id, "delete_transactions", None if dry_run else idempotency_key, arguments
        )
        if stored is not None:
            return stored

        service = TransactionMutationService(db, user_id)

        found = (
            db.query(Transaction)
            .filter(Transaction.user_id == user_id, Transaction.id.in_(uuids))
            .options(joinedload(Transaction.account), joinedload(Transaction.category))
            .order_by(Transaction.booked_at.desc())
            .all()
        )
        if not found:
            raise not_found(
                "transaction",
                transaction_ids[0] if len(transaction_ids) == 1 else transaction_ids,
                tool="search_transactions",
            )

        found_ids = {t.id for t in found}
        not_found_ids = [str(u) for u in uuids if u not in found_ids]

        # Read before the delete: "what am I about to lose" is the whole
        # question a preview is asked, and the transfer siblings pulled in
        # alongside are the part the caller did not ask for.
        all_ids = service.include_linked_transfer_transactions(list(found_ids))
        linked_ids = [str(i) for i in all_ids if i not in found_ids]
        doomed = [
            {
                "id": str(t.id),
                "account_name": t.account.name if t.account else None,
                "amount": float(t.amount),
                "currency": t.currency,
                "description": t.description,
                "merchant": t.merchant,
                "category_name": t.category.name if t.category else None,
                "booked_at": t.booked_at.isoformat() if t.booked_at else None,
            }
            for t in found[:20]
        ]

        try:
            impacts, _, _ = service.get_delete_impact(list(found_ids))
            _, deleted_count = service.bulk_delete(list(found_ids))
            response = {
                "deleted_count": deleted_count,
                "requested_count": len(transaction_ids),
                "not_found_ids": not_found_ids,
                "deleted_transactions": doomed,
                "linked_transfer_ids": linked_ids,
                "account_impacts": [
                    {
                        "account_id": str(impact["account_id"]),
                        "account_name": impact["account_name"],
                        "currency": impact["currency"],
                        "amount_change": float(impact["amount_change"]),
                        "current_balance": float(impact["current_balance"]),
                        "projected_balance": float(impact["projected_balance"]),
                    }
                    for impact in impacts
                ],
                "dry_run": dry_run,
                "committed": not dry_run,
            }
        except LookupError as e:
            db.rollback()
            raise ToolError(str(e)) from None
        except ValueError as e:
            db.rollback()
            raise ToolError(str(e)) from None
        except Exception as e:  # noqa: BLE001
            db.rollback()
            raise_database_error("delete_transactions", e)

    if not dry_run:
        _remember(user_id, "delete_transactions", idempotency_key, digest, response)
    return response


def create_transfer(
    user_id: str,
    from_account_id: str,
    to_account_id: str,
    amount: float,
    description: str,
    booked_at: Optional[str] = None,
    dry_run: bool = False,
    idempotency_key: Optional[str] = None,
) -> dict:
    """
    Move money between two of the user's own accounts.

    Books both sides -- a debit on the source, a credit on the destination
    -- links them, and marks both as outside analytics. That last part is
    the reason this is not two create_transaction calls: a transfer booked
    as a plain pair shows up as a month's largest expense and an equal
    windfall, and every spending figure after it is wrong.

    Both accounts must hold the same currency; cross-currency transfers are
    not supported yet.

    Args:
        user_id: The user's ID
        from_account_id: The account money leaves, from list_accounts()
        to_account_id: The account money arrives in
        amount: A positive magnitude
        description: What the movement was
        booked_at: YYYY-MM-DD or an ISO timestamp. Defaults to today.
        dry_run: Book it, report it, then roll it back (default False)
        idempotency_key: Caller-chosen id making a retry safe

    Returns:
        {"source_transaction", "destination_transaction", "dry_run",
        "committed"}
    """
    if not description or not description.strip():
        raise missing_argument("description", "a transfer needs a non-empty description")
    money = _require_positive_amount(amount)
    when = _write_booked_at(booked_at)

    arguments = {
        "from_account_id": from_account_id,
        "to_account_id": to_account_id,
        "amount": amount,
        "description": description,
        "booked_at": booked_at,
    }

    with _session(dry_run) as db:
        stored, digest = replay(
            db, user_id, "create_transfer", None if dry_run else idempotency_key, arguments
        )
        if stored is not None:
            return stored

        source = _require_owned_account(db, user_id, from_account_id, "from_account_id")
        destination = _require_owned_account(db, user_id, to_account_id, "to_account_id")

        try:
            source_txn, destination_txn = TransactionMutationService(db, user_id).create_transfer(
                source_account_id=source.id,
                destination_account_id=destination.id,
                amount=money,
                description=description,
                booked_at=when,
            )
            response = {
                "source_transaction": _serialize_transaction(source_txn),
                "destination_transaction": _serialize_transaction(destination_txn),
                "dry_run": dry_run,
                "committed": not dry_run,
            }
        except LookupError as e:
            db.rollback()
            raise ToolError(str(e)) from None
        except ValueError as e:
            db.rollback()
            raise ToolError(str(e)) from None
        except Exception as e:  # noqa: BLE001
            db.rollback()
            raise_database_error("create_transfer", e)

    if not dry_run:
        _remember(user_id, "create_transfer", idempotency_key, digest, response)
    return response
