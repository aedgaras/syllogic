"""
Main FastMCP server setup for Syllogic.
Registers all tools from the tools modules.
"""

from fastmcp import Context, FastMCP
from fastmcp.dependencies import Depends
from fastmcp.exceptions import ToolError
from fastmcp.server.auth import RemoteAuthProvider
from fastmcp.server.transforms.visibility import Visibility
from pydantic import AnyHttpUrl

from app.db_helpers import get_mcp_user_id
from app.mcp.auth import CompositeAuthProvider, AS_ISSUER, MCP_PUBLIC_URL
from app.mcp.middleware import PerUserRateLimit, ToolCallLogger, ToolsetSelection
from app.mcp.schemas import (
    AccountOut,
    CategoryAmountOut,
    CategoryOut,
    MutationResult,
    TransactionOut,
    TransactionPage,
    TransactionSearchPage,
)
from app.mcp import prompts as mcp_prompts
from app.mcp import resources as mcp_resources
from app.mcp import toolsets
from app.mcp.tools import (
    accounts,
    budgets as budget_tools,
    categories,
    transactions,
    analytics,
    recurring,
    investments,
    people as people_tools,
    reports as report_tools,
)


def authenticated_user_id() -> str:
    """Resolve the calling user from the bearer token.

    Injected into every tool rather than accepted as an argument. The
    parameter was only ever allowed to equal the authenticated user, so
    carrying it in 35 tool schemas cost the client tokens on every session
    without offering a real choice.
    """
    try:
        return get_mcp_user_id()
    except ValueError as exc:
        # FastMCP wraps any non-FastMCPError raised during dependency
        # resolution into "Failed to resolve dependency 'user_id'" and logs a
        # full traceback. ToolError passes through untouched, so the caller
        # gets told what's actually wrong.
        raise ToolError(str(exc)) from exc


_auth = RemoteAuthProvider(
    token_verifier=CompositeAuthProvider(),
    authorization_servers=[AnyHttpUrl(AS_ISSUER)],
    # Server root (no /mcp path). FastMCP appends the route itself when
    # advertising the Protected Resource, so passing "https://mcp.syllogic.ai/mcp"
    # here produced a broken resource URL of "https://mcp.syllogic.ai/mcp/mcp".
    base_url=MCP_PUBLIC_URL,
)

# Initialize FastMCP server
mcp = FastMCP(
    name="Syllogic MCP",
    instructions="""
Syllogic MCP Server - your financial data: accounts, transactions, categories,
analytics, budgets, recurring bills, investments and scheduled email reports.

Auth: a bearer token, either an API key (`pf_...`) or an OAuth 2.1 access
token. The calling user comes from that token, so no tool takes a user id.

## Most of the server is not listed yet

Budgets, recurring bills, investments, scheduled reports and transaction
editing sit behind `load_toolset`. Call it the moment the user's question
reaches one of those, rather than saying it is unsupported.

## Read these first

- `syllogic://schema` — what the fields mean: major units, how currency
  conversion is reported, that date ranges are inclusive, and which of the
  two category fields wins. Read it before interpreting any number.
- `syllogic://categories` — the category tree plus the categorization rules
  the user has already written.
- `syllogic://accounts`, `syllogic://people` — names and ids, no balances.

## Prompts for the common jobs

`categorize_uncategorized`, `month_end_close`, `budget_review`,
`spending_investigation`. Each one is the full tool sequence with the
arguments filled in; reach for them before assembling your own.

## Two things that bite

- **Always `dry_run` a write first and show the user what changes.** These
  are their records, and they have not seen the rows you are about to touch.
- **`match_mode="word"` when searching for a merchant name.** The default is
  substring, so "Action" matches "Transaction".

## Paging

List and search tools take `cursor`; pass `next_cursor` from the previous
response until it comes back empty. `total_count` is only on the first page.
""",
    auth=_auth,
)


# ============================================================================
# Account Tools
# ============================================================================


@mcp.tool(tags={"core", "read"}, annotations={"readOnlyHint": True})
def list_accounts(
    user_id: str = Depends(authenticated_user_id),
    include_inactive: bool = False,
    asset_class: str | None = None,
    person_ids: list[str] | None = None,
) -> list[AccountOut]:
    """
    List all accounts for a user.

    Args:
        include_inactive: Whether to include inactive accounts (default: False)
        asset_class: Optional asset-class filter, one of "cash", "savings",
            "investment", "crypto", "property", "vehicle", "other".
        person_ids: Optional list of person UUIDs. When provided, only returns
            accounts owned by any of those people. When exactly one person_id
            is given, each account also includes `owners` and `attributed_balance`
            (share-weighted to that person's ownership fraction).

    Returns:
        List of account dictionaries with id, name, account_type, asset_class,
        institution, currency, balance, etc.
    """
    return accounts.list_accounts(user_id, include_inactive, asset_class, person_ids)


@mcp.tool(tags={"core", "read"}, annotations={"readOnlyHint": True})
def get_account(
    account_id: str, user_id: str = Depends(authenticated_user_id)
) -> AccountOut | None:
    """
    Get a single account by ID.

    Args:
        account_id: The account's ID

    Returns:
        Account dictionary (with asset_class derived from account_type) or None if not found
    """
    return accounts.get_account(user_id, account_id)


@mcp.tool(tags={"core", "read"}, annotations={"readOnlyHint": True})
def get_account_balance_history(
    account_id: str,
    from_date: str | None = None,
    to_date: str | None = None,
    user_id: str = Depends(authenticated_user_id),
    person_ids: list[str] | None = None,
) -> list[dict]:
    """
    Get daily balance history for an account.

    Args:
        account_id: The account's ID
        from_date: Start date, ISO YYYY-MM-DD, inclusive (optional)
        to_date: End date, ISO YYYY-MM-DD, inclusive of the whole day (optional)
        person_ids: Optional list of person UUIDs. When provided, returns an
            empty list if the account is not owned by any of those people.

    Returns:
        List of balance snapshots with date, balance in account currency, and functional currency
    """
    return accounts.get_account_balance_history(user_id, account_id, from_date, to_date, person_ids)


# ============================================================================
# Category Tools
# ============================================================================


@mcp.tool(tags={"core", "read"}, annotations={"readOnlyHint": True})
def list_categories(
    user_id: str = Depends(authenticated_user_id), category_type: str | None = None
) -> list[CategoryOut]:
    """
    List all categories for a user.

    Args:
        category_type: Filter by type (expense, income, transfer) - optional

    Returns:
        List of category dictionaries with id, name, type, color, icon, parent info
    """
    return categories.list_categories(user_id, category_type)


@mcp.tool(tags={"core", "read"}, annotations={"readOnlyHint": True})
def get_category(
    category_id: str, user_id: str = Depends(authenticated_user_id)
) -> CategoryOut | None:
    """
    Get a single category by ID.

    Args:
        category_id: The category's ID

    Returns:
        Category dictionary or None if not found
    """
    return categories.get_category(user_id, category_id)


@mcp.tool(
    tags={"edit_transactions", "write"},
    annotations={"destructiveHint": False, "idempotentHint": True},
)
def update_category(
    category_id: str,
    description: str | None = None,
    categorization_instructions: str | None = None,
    dry_run: bool = False,
    user_id: str = Depends(authenticated_user_id),
) -> MutationResult:
    """
    Update a category's description and/or categorization_instructions.

    Use this to persist categorization context you learn during a conversation
    (e.g. "transactions from <merchant> should be Groceries unless the amount
    is under €5") so that future AI categorization applies the same rules.

    Only provided fields are written. Pass an empty string ("") to explicitly
    clear a field. System categories (e.g. Internal Transfer, External
    Transfer) are editable via this tool — description and
    categorization_instructions are user-tailored context.

    Args:
        category_id: The category's ID
        description: New human-readable description for this category (optional)
        categorization_instructions: Instructions the AI should follow when
            deciding whether a transaction belongs in this category (optional)
        dry_run: Preview the change and roll it back, without writing (default False)

    Returns:
        {"changed", "before", "after", "fields_changed", "category",
        "dry_run", "committed"}. `changed` is False when the values were
        already what you asked for, so you can say "already set" rather than
        claiming an edit. Raises on invalid input or an unknown category_id.
    """
    return categories.update_category(
        user_id,
        category_id,
        description,
        categorization_instructions,
        dry_run=dry_run,
    )


@mcp.tool(tags={"core", "read"}, annotations={"readOnlyHint": True})
def get_category_tree(user_id: str = Depends(authenticated_user_id)) -> list[dict]:
    """
    Get categories in a hierarchical tree structure.

    Args:

    Returns:
        List of root categories, each with nested 'children' list
    """
    return categories.get_category_tree(user_id)


# ============================================================================
# Transaction Tools
# ============================================================================


@mcp.tool(tags={"core", "read"}, annotations={"readOnlyHint": True})
def list_transactions(
    account_id: str | None = None,
    category_id: str | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
    search: str | None = None,
    limit: int = 50,
    page: int = 1,
    cursor: str | None = None,
    sort_by: str = "booked_at_desc",
    uncategorized: bool = False,
    category_type: str | None = None,
    account_ids: list[str] | None = None,
    category_ids: list[str] | None = None,
    min_amount: float | None = None,
    max_amount: float | None = None,
    merchant: str | None = None,
    user_id: str = Depends(authenticated_user_id),
) -> TransactionPage:
    """
    Browse transactions by filter, newest first. No text matching.

    For anything involving a search term, use search_transactions. For a
    category breakdown rather than rows, use get_amounts_by_category.

    Args:
        account_id: Filter to one account (alias for account_ids=[...])
        category_id: Filter to one category (alias for category_ids=[...])
        account_ids: Filter to any of these accounts (optional)
        category_ids: Filter to any of these categories. Matched on the
            effective category: the user override, else the AI assignment.
        min_amount: Minimum absolute amount, so 50 means "50 or more" for an
            expense and for an income row alike (optional)
        max_amount: Maximum absolute amount (optional)
        merchant: Exact merchant name, case-insensitive. For fuzzy matching
            use search_transactions (optional)
        from_date: Start date, ISO YYYY-MM-DD, inclusive (optional)
        to_date: End date, ISO YYYY-MM-DD, inclusive of the whole day (optional)
        search: DEPRECATED — use search_transactions, which offers match
            modes. This one is a bare substring match, so "Action" matches
            "Transaction".
        limit: Max results per page (default: 50, max: 100)
        page: Page number (default: 1) - ignored when cursor is provided
        cursor: Opaque cursor from a previous response
        sort_by: See "Pagination & sort" in the server instructions
        uncategorized: If True, return only transactions with no category
        category_type: Filter by resolved category type (expense, income, transfer)

    Returns:
        Dict with transactions list, limit, page (or None), and next_cursor
    """
    return transactions.list_transactions(
        user_id,
        account_id,
        category_id,
        from_date,
        to_date,
        search,
        limit,
        page,
        cursor,
        sort_by,
        uncategorized,
        category_type,
        account_ids=account_ids,
        category_ids=category_ids,
        min_amount=min_amount,
        max_amount=max_amount,
        merchant=merchant,
    )


@mcp.tool(tags={"core", "read"}, annotations={"readOnlyHint": True})
def get_transaction(
    transaction_id: str, user_id: str = Depends(authenticated_user_id)
) -> TransactionOut | None:
    """
    Get a single transaction by ID.

    Args:
        transaction_id: The transaction's ID

    Returns:
        Transaction dictionary or None if not found
    """
    return transactions.get_transaction(user_id, transaction_id)


@mcp.tool(tags={"core", "read"}, annotations={"readOnlyHint": True})
def search_transactions(
    query: str | None = None,
    queries: list[str] | None = None,
    exclude_category_id: str | None = None,
    match_mode: str = "contains",
    ids_only: bool = False,
    limit: int = 50,
    page: int = 1,
    cursor: str | None = None,
    sort_by: str = "booked_at_desc",
    account_id: str | None = None,
    account_ids: list[str] | None = None,
    category_ids: list[str] | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
    min_amount: float | None = None,
    max_amount: float | None = None,
    merchant: str | None = None,
    user_id: str = Depends(authenticated_user_id),
) -> TransactionSearchPage:
    """
    Find transactions by text, with filters. The one to reach for when
    matching merchant or description text.

    Pass `queries` to search several terms at once — one call, not N, which
    is what makes a bulk recategorization affordable. For browsing by filter
    with no text at all, list_transactions is the plainer tool.

    Args:
        query: One search string (case-insensitive)
        queries: Several search strings; a transaction matching ANY of them
            is returned, e.g. ["Jumbo", "Albert Heijn", "ALDI"]. Combines
            with `query`. The response carries `query_counts` so you can see
            which terms actually matched.
        exclude_category_id: Skip transactions already in this category
        match_mode: "contains" (default), "starts_with", or "word".
            Use "word" for merchant names — the default is a substring match,
            so "Action" matches "Transaction".
        ids_only: If True, return only transaction IDs
        limit: Max results per page (default: 50, max: 100)
        page: Page number (default: 1) - ignored when cursor is provided
        cursor: Opaque cursor from a previous response
        sort_by: See "Pagination & sort" in the server instructions
        account_id: Filter to one account (alias for account_ids=[...])
        account_ids: Filter to any of these accounts (optional)
        category_ids: Filter to any of these categories, matched on the
            effective category (user override, else AI assignment)
        from_date / to_date: Date range, both inclusive (optional)
        min_amount / max_amount: Absolute amount bounds (optional)
        merchant: Exact merchant name, case-insensitive (optional)

    Returns:
        Dict with transactions (or transaction_ids), page, limit, has_more,
        total_count, query_counts (when `queries` was used), and next_cursor.
        Keep paginating while has_more is true.
    """
    return transactions.search_transactions(
        user_id,
        query,
        queries,
        exclude_category_id,
        match_mode,
        ids_only,
        limit,
        page,
        cursor,
        sort_by,
        account_id,
        account_ids=account_ids,
        category_ids=category_ids,
        from_date=from_date,
        to_date=to_date,
        min_amount=min_amount,
        max_amount=max_amount,
        merchant=merchant,
    )


@mcp.tool(
    tags={"edit_transactions", "write"},
    annotations={"destructiveHint": False, "idempotentHint": True},
)
def update_transaction_category(
    transaction_id: str,
    category_id: str,
    dry_run: bool = False,
    user_id: str = Depends(authenticated_user_id),
) -> MutationResult:
    """
    Update the category of a transaction (user override).

    This sets the user-defined category (category_id), which takes precedence
    over the AI-assigned category (category_system_id).

    Args:
        transaction_id: The transaction's ID
        category_id: The new category ID to assign
        dry_run: Preview the change and roll it back, without writing (default False)

    Returns:
        {"changed", "before", "after", "fields_changed", "transaction",
        "dry_run", "committed"}. `changed` is False when the transaction was
        already in that category. Raises on invalid input or an unknown
        transaction_id/category_id.
    """
    return transactions.update_transaction_category(
        user_id, transaction_id, category_id, dry_run=dry_run
    )


@mcp.tool(
    tags={"edit_transactions", "write"},
    annotations={"destructiveHint": False, "idempotentHint": True},
)
def bulk_update_transaction_categories(
    category_id: str,
    transaction_ids: list[str],
    dry_run: bool = False,
    user_id: str = Depends(authenticated_user_id),
) -> dict:
    """
    Recategorize many transactions in one call.

    Feed it `transaction_ids` from `search_transactions(queries=[...],
    ids_only=True)`. Run it with `dry_run=True` first and show the user
    `sample_changes` -- the `categorize_uncategorized` prompt is this whole
    sequence with the arguments filled in.

    Args:
        category_id: The category to assign to all of them
        transaction_ids: Transactions to update (max 2000)
        dry_run: Preview what would change without committing (default False)

    Returns:
        {"updated_count" (or "would_update_count" when dry_run),
        "requested_count", "invalid_ids", "not_found_ids",
        "skipped_already_in_category_ids", "sample_changes" (up to 10)}
    """
    return transactions.bulk_update_transaction_categories(
        user_id, category_id, transaction_ids, dry_run
    )


@mcp.tool(
    tags={"edit_transactions", "write"},
    annotations={"destructiveHint": False, "idempotentHint": False},
)
def create_transaction(
    account_id: str,
    amount: float,
    description: str,
    transaction_type: str = "debit",
    booked_at: str | None = None,
    merchant: str | None = None,
    category_id: str | None = None,
    include_in_analytics: bool = True,
    dry_run: bool = False,
    idempotency_key: str | None = None,
    user_id: str = Depends(authenticated_user_id),
) -> dict:
    """
    Record one expense or income transaction.

    Books it the way the app's own "add transaction" screen does: the
    currency conversion is derived and the account balance is recalculated
    from its date forward. For money moving between two of the user's own
    accounts use create_transfer, which books both sides and keeps the
    movement out of spending totals.

    Args:
        account_id: The account it lands on, from list_accounts()
        amount: A positive magnitude. The sign comes from
            `transaction_type`, never from this number.
        description: What it was. Required — it is what the user reads in
            their ledger and what categorization matches on later.
        transaction_type: "debit"/"expense" (money out, the default) or
            "credit"/"income" (money in)
        booked_at: YYYY-MM-DD, or an ISO timestamp. Defaults to today.
        merchant: Who was paid, or who paid (optional)
        category_id: Category from list_categories() (optional). Left unset
            the transaction stays uncategorized; nothing assigns one later
            on its own.
        include_in_analytics: False keeps it out of spending charts and KPIs
            (default True)
        dry_run: Book it, report it, then roll it back (default False)
        idempotency_key: Caller-chosen id making a retry safe. Without one,
            a retry after a lost response books the expense twice.

    Returns:
        {"transaction": {...}, "dry_run": bool, "committed": bool}
    """
    return transactions.create_transaction(
        user_id,
        account_id,
        amount,
        description,
        transaction_type=transaction_type,
        booked_at=booked_at,
        merchant=merchant,
        category_id=category_id,
        include_in_analytics=include_in_analytics,
        dry_run=dry_run,
        idempotency_key=idempotency_key,
    )


@mcp.tool(
    tags={"edit_transactions", "write"},
    annotations={"destructiveHint": False, "idempotentHint": True},
)
def update_transaction(
    transaction_id: str,
    amount: float | None = None,
    transaction_type: str | None = None,
    booked_at: str | None = None,
    description: str | None = None,
    merchant: str | None = None,
    account_id: str | None = None,
    category_id: str | None = None,
    include_in_analytics: bool | None = None,
    dry_run: bool = False,
    idempotency_key: str | None = None,
    user_id: str = Depends(authenticated_user_id),
) -> MutationResult:
    """
    Edit a transaction. Omitted fields keep their current value.

    Changing the amount, type, date or account re-derives the currency
    conversion and recalculates the account's balance from the earlier of
    the old and the new date — both accounts, when it moves between them.
    The other fields are a plain patch.

    For the category alone, update_transaction_category is the smaller call.

    Args:
        transaction_id: The transaction's ID
        amount: New positive magnitude; the sign follows the type (optional)
        transaction_type: "debit"/"expense" or "credit"/"income" (optional)
        booked_at: New YYYY-MM-DD or ISO timestamp (optional)
        description: New description. Cannot be blanked (optional)
        merchant: New merchant, or "" to clear it (optional)
        account_id: Move it to another account (optional)
        category_id: New category, or "" to clear the override (optional)
        include_in_analytics: Whether it counts toward spending charts and
            KPIs (optional)
        dry_run: Apply it, report it, then roll it back (default False)
        idempotency_key: Caller-chosen id making a retry safe

    Returns:
        {"changed", "before", "after", "fields_changed", "transaction",
        "dry_run", "committed"}. `changed` is False when the values were
        already what was asked for. Raises when the transaction is one side
        of an internal transfer or a balancing entry — unlink it first.
    """
    return transactions.update_transaction(
        user_id,
        transaction_id,
        amount=amount,
        transaction_type=transaction_type,
        booked_at=booked_at,
        description=description,
        merchant=merchant,
        account_id=account_id,
        category_id=category_id,
        include_in_analytics=include_in_analytics,
        dry_run=dry_run,
        idempotency_key=idempotency_key,
    )


@mcp.tool(
    tags={"edit_transactions", "write"},
    annotations={"destructiveHint": True, "idempotentHint": True},
)
def delete_transactions(
    transaction_ids: list[str],
    dry_run: bool = False,
    idempotency_key: str | None = None,
    user_id: str = Depends(authenticated_user_id),
) -> dict:
    """
    Permanently delete transactions and recalculate the balances they moved.

    There is no undo. Preview with dry_run=True and show the user the rows
    before committing.

    Both sides of an internal transfer go together: deleting one alone would
    leave the other as unexplained income or spending, so naming either one
    deletes the pair. `deleted_count` can therefore exceed the number of ids
    passed.

    Args:
        transaction_ids: The transactions to delete (max 500)
        dry_run: Report what would be destroyed without destroying it
            (default False)
        idempotency_key: Caller-chosen id making a retry safe

    Returns:
        {"deleted_count", "requested_count", "not_found_ids",
        "deleted_transactions" (up to 20 rows), "linked_transfer_ids",
        "account_impacts" (each account's balance before and after),
        "dry_run", "committed"}
    """
    return transactions.delete_transactions(
        user_id, transaction_ids, dry_run=dry_run, idempotency_key=idempotency_key
    )


@mcp.tool(
    tags={"edit_transactions", "write"},
    annotations={"destructiveHint": False, "idempotentHint": False},
)
def create_transfer(
    from_account_id: str,
    to_account_id: str,
    amount: float,
    description: str,
    booked_at: str | None = None,
    dry_run: bool = False,
    idempotency_key: str | None = None,
    user_id: str = Depends(authenticated_user_id),
) -> dict:
    """
    Move money between two of the user's own accounts.

    Books both sides — a debit on the source, a credit on the destination —
    links them, and keeps both out of analytics. That last part is why this
    is not two create_transaction calls: a transfer booked as a plain pair
    becomes the month's largest expense plus an equal windfall, and every
    spending figure after it is wrong.

    Both accounts must hold the same currency; cross-currency transfers are
    not supported yet.

    Args:
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
    return transactions.create_transfer(
        user_id,
        from_account_id,
        to_account_id,
        amount,
        description,
        booked_at=booked_at,
        dry_run=dry_run,
        idempotency_key=idempotency_key,
    )


# ============================================================================
# Analytics Tools
# ============================================================================


@mcp.tool(tags={"core", "read"}, annotations={"readOnlyHint": True})
def get_amounts_by_category(
    direction: str = "expense",
    from_date: str | None = None,
    to_date: str | None = None,
    account_id: str | None = None,
    include_uncategorized: bool = False,
    group_by: str = "none",
    user_id: str = Depends(authenticated_user_id),
    person_ids: list[str] | None = None,
) -> list[CategoryAmountOut]:
    """
    Where the money went, or came from, by category — optionally by period.

    The tool for "what do I spend on X", "how much came in from Y", and
    "how has X moved month to month". For the transactions themselves rather
    than the totals, use search_transactions or list_transactions.

    Args:
        direction: "expense" (money out, the default) or "income" (money in)
        from_date: Start date, ISO YYYY-MM-DD, inclusive (optional)
        to_date: End date, ISO YYYY-MM-DD, inclusive of the whole day (optional)
        account_id: Filter by account ID (optional)
        include_uncategorized: Add an "Uncategorized" bucket for transactions
            with no category at all. Expenses only. Worth passing during any
            review — an empty bucket is a fact, and a full one means every
            other total here is understated.
        group_by: "none" (default), "month", "quarter" or "year". Anything but
            "none" returns one row per category per period, with a `period`
            field — the cross-tab that otherwise costs one call per month.
        person_ids: Optional list of person UUIDs. When provided, only includes
            transactions from accounts owned by any of those people.

    Returns:
        List of rows with category_id, category_name, category_color, total,
        currency, count, unconverted_transaction_count, merchant_count
        (expenses only), and `period` when group_by is set. Totals are in your
        functional currency; a non-zero unconverted_transaction_count means
        the total is an undercount.
    """
    return analytics.get_amounts_by_category(
        user_id,
        direction=direction,
        from_date=from_date,
        to_date=to_date,
        account_id=account_id,
        include_uncategorized=include_uncategorized,
        person_ids=person_ids,
        group_by=group_by,
    )


@mcp.tool(tags={"core", "read"}, annotations={"readOnlyHint": True})
def get_monthly_cashflow(
    from_date: str | None = None,
    to_date: str | None = None,
    user_id: str = Depends(authenticated_user_id),
    person_ids: list[str] | None = None,
) -> list[dict]:
    """
    Get monthly income vs expenses breakdown.

    Args:
        from_date: Start date, ISO YYYY-MM-DD, inclusive (optional)
        to_date: End date, ISO YYYY-MM-DD, inclusive of the whole day (optional)
        person_ids: Optional list of person UUIDs. When provided, only includes
            transactions from accounts owned by any of those people.

    Returns:
        List of monthly data with income, expenses, and net for each month
    """
    return analytics.get_monthly_cashflow(user_id, from_date, to_date, person_ids)


@mcp.tool(tags={"core", "read"}, annotations={"readOnlyHint": True})
def get_financial_summary(
    from_date: str | None = None,
    to_date: str | None = None,
    user_id: str = Depends(authenticated_user_id),
    person_ids: list[str] | None = None,
) -> dict:
    """
    Get a financial summary with totals and account balances.

    Args:
        from_date: Start date, ISO YYYY-MM-DD, inclusive (optional)
        to_date: End date, ISO YYYY-MM-DD, inclusive of the whole day (optional)
        person_ids: Optional list of person UUIDs. When provided, only includes
            transactions and balances from accounts owned by any of those people.
            When exactly one person_id is given, account balances are
            share-weighted to that person's ownership fraction.

    Returns:
        Summary with total income, total expenses, net, savings rate, and account balances
    """
    return analytics.get_financial_summary(user_id, from_date, to_date, person_ids)


@mcp.tool(tags={"core", "read"}, annotations={"readOnlyHint": True})
def get_top_merchants(
    from_date: str | None = None,
    to_date: str | None = None,
    limit: int = 10,
    category_id: str | None = None,
    uncategorized: bool = False,
    user_id: str = Depends(authenticated_user_id),
) -> list[dict]:
    """
    Get top merchants by total spending.

    Args:
        from_date: Start date, ISO YYYY-MM-DD, inclusive (optional)
        to_date: End date, ISO YYYY-MM-DD, inclusive of the whole day (optional)
        limit: Max number of merchants (default: 10, max: 50)
        category_id: Filter to transactions in this category (optional).
            Mutually exclusive with uncategorized.
        uncategorized: If True, return only transactions with no category.
            Mutually exclusive with category_id.

    Returns:
        List of merchants with total spending and transaction count
    """
    return analytics.get_top_merchants(
        user_id, from_date, to_date, limit, category_id, uncategorized
    )


# ============================================================================
# Recurring Transaction Tools
# ============================================================================


@mcp.tool(tags={"recurring", "read"}, annotations={"readOnlyHint": True})
def list_recurring_transactions(
    is_active: bool | None = None, user_id: str = Depends(authenticated_user_id)
) -> list[dict]:
    """
    List recurring transactions (subscriptions/bills) for a user.

    Args:
        is_active: Filter by active status (optional, defaults to showing all)

    Returns:
        List of recurring transactions with details
    """
    return recurring.list_recurring_transactions(user_id, is_active)


@mcp.tool(tags={"recurring", "read"}, annotations={"readOnlyHint": True})
def get_recurring_transaction(
    recurring_id: str, user_id: str = Depends(authenticated_user_id)
) -> dict | None:
    """
    Get a single recurring transaction by ID.

    Args:
        recurring_id: The recurring transaction's ID

    Returns:
        Recurring transaction dictionary or None if not found
    """
    return recurring.get_recurring_transaction(user_id, recurring_id)


@mcp.tool(tags={"recurring", "read"}, annotations={"readOnlyHint": True})
def get_recurring_summary(user_id: str = Depends(authenticated_user_id)) -> dict:
    """
    Get a summary of recurring transactions (subscriptions/bills).

    Args:

    Returns:
        Summary with totals by frequency, importance groups, and monthly/yearly costs
    """
    return recurring.get_recurring_summary(user_id)


@mcp.tool(tags={"recurring", "write"}, annotations={"destructiveHint": False})
def create_recurring_transaction(
    name: str,
    amount: float,
    account_id: str,
    frequency: str,
    merchant: str | None = None,
    currency: str = "EUR",
    category_id: str | None = None,
    importance: int = 3,
    description: str | None = None,
    is_variable_amount: bool = False,
    next_due_date: str | None = None,
    end_date: str | None = None,
    auto_generate: bool = False,
    is_active: bool = True,
    dry_run: bool = False,
    idempotency_key: str | None = None,
    user_id: str = Depends(authenticated_user_id),
) -> dict:
    """
    Create a recurring transaction (subscription or bill).

    Two kinds of definition come out of this tool, and `next_due_date`
    decides which. Without it you get a label: it groups matching
    transactions and counts toward the subscription totals, and nothing is
    ever written. With it plus `auto_generate=True`, a real transaction is
    booked on every due date by the daily 05:00 UTC job.

    Args:
        name: What the subscription is called. Unique per account.
        amount: The typical charge, as a positive number. The sign of the
            booked transaction comes from the category type -- an income
            category produces a credit, anything else a debit.
        account_id: Account the charge lands on, from list_accounts()
        frequency: weekly, biweekly, monthly, quarterly, or yearly
        merchant: Merchant name, used when matching real bank rows (optional)
        currency: ISO code for `amount` (default EUR)
        category_id: Category from list_categories() (optional)
        importance: 1 (nice to have) to 3 (essential), default 3
        description: Free-text note (optional)
        is_variable_amount: True when the charge varies month to month.
            `amount` becomes an estimate, and duplicate detection stops
            comparing amounts. (default False)
        next_due_date: YYYY-MM-DD of the next charge (optional)
        end_date: YYYY-MM-DD after which the schedule stops (optional)
        auto_generate: Book a transaction on every due date. Requires
            next_due_date. (default False)
        is_active: Whether it counts toward subscription totals (default True)
        dry_run: Preview the change and roll it back, without writing (default False)
        idempotency_key: Caller-chosen id that makes a retry safe. The same
            key with the same arguments replays the first response instead of
            writing again; the same key with different arguments is rejected.

    Returns:
        {"recurring_transaction": {...}, "dry_run": bool, "committed": bool}
    """
    return recurring.create_recurring_transaction(
        user_id,
        name,
        amount,
        account_id,
        frequency,
        merchant,
        currency,
        category_id,
        importance,
        description,
        is_variable_amount,
        next_due_date,
        end_date,
        auto_generate,
        is_active,
        dry_run,
        idempotency_key,
    )


@mcp.tool(
    tags={"recurring", "write"}, annotations={"destructiveHint": False, "idempotentHint": True}
)
def update_recurring_transaction(
    recurring_id: str,
    name: str | None = None,
    amount: float | None = None,
    account_id: str | None = None,
    frequency: str | None = None,
    merchant: str | None = None,
    currency: str | None = None,
    category_id: str | None = None,
    importance: int | None = None,
    description: str | None = None,
    is_variable_amount: bool | None = None,
    next_due_date: str | None = None,
    end_date: str | None = None,
    auto_generate: bool | None = None,
    is_active: bool | None = None,
    dry_run: bool = False,
    idempotency_key: str | None = None,
    user_id: str = Depends(authenticated_user_id),
) -> dict:
    """
    Update a recurring transaction. Omitted fields keep their current value.

    This is also how a subscription is cancelled: `is_active=False` stops
    the totals and `auto_generate=False` stops the booking, both without
    losing the history. Deleting is the destructive option.

    Args:
        recurring_id: The recurring transaction's ID
        name: New name (optional)
        amount: New typical charge, must be > 0 (optional)
        account_id: Move it to another account (optional)
        frequency: weekly, biweekly, monthly, quarterly, yearly (optional)
        merchant: New merchant, or "" to clear it (optional)
        currency: New ISO code (optional). Re-denominates, does not convert.
        category_id: New category, or "" to clear it (optional)
        importance: 1-3 (optional)
        description: New note, or "" to clear it (optional)
        is_variable_amount: Whether the charge varies (optional)
        next_due_date: YYYY-MM-DD, or "" to clear the schedule (optional)
        end_date: YYYY-MM-DD, or "" to remove the end (optional)
        auto_generate: Turn automatic booking on or off (optional). Turning
            it on needs a next_due_date, here or already on file.
        is_active: Activate or deactivate (optional)
        dry_run: Preview the change and roll it back, without writing (default False)
        idempotency_key: Caller-chosen id that makes a retry safe

    Returns:
        {"changed", "before", "after", "fields_changed",
        "recurring_transaction", "dry_run", "committed"}. `changed` is False
        when every field already held the value asked for.
    """
    return recurring.update_recurring_transaction(
        user_id,
        recurring_id,
        name,
        amount,
        account_id,
        frequency,
        merchant,
        currency,
        category_id,
        importance,
        description,
        is_variable_amount,
        next_due_date,
        end_date,
        auto_generate,
        is_active,
        dry_run,
        idempotency_key,
    )


@mcp.tool(tags={"recurring", "write"}, annotations={"idempotentHint": True})
def delete_recurring_transaction(
    recurring_id: str,
    dry_run: bool = False,
    user_id: str = Depends(authenticated_user_id),
) -> dict:
    """
    Permanently delete a recurring transaction definition.

    The transactions it booked are kept but unlinked, so they stay in the
    ledger with no subscription attached. For "I cancelled this
    subscription", prefer update_recurring_transaction(is_active=False):
    the history and the totals for past months stay correct.

    Args:
        recurring_id: The recurring transaction's ID
        dry_run: Report what would be destroyed without destroying it
            (default False). The count of transactions that would be
            unlinked is in the response.

    Returns:
        {"deleted_recurring_transaction": {...}, "dry_run": bool, "committed": bool}
    """
    return recurring.delete_recurring_transaction(user_id, recurring_id, dry_run)


@mcp.tool(tags={"recurring", "write"}, annotations={"destructiveHint": False})
def generate_recurring_occurrence(
    recurring_id: str,
    dry_run: bool = False,
    idempotency_key: str | None = None,
    user_id: str = Depends(authenticated_user_id),
) -> dict:
    """
    Book the next scheduled occurrence now, ahead of its due date.

    Runs the same generator the daily job runs -- same sign, same currency
    conversion, same account balance recalculation -- and advances the
    definition to the following occurrence.

    `created_count` of 0 means that date was already covered: a real bank
    row within 7 days and 15% of the expected amount counts as the charge
    having already happened.

    Args:
        recurring_id: The recurring transaction's ID
        dry_run: Generate it, report it, then roll it back (default False)
        idempotency_key: Caller-chosen id that makes a retry safe. Worth
            passing here: without one, a retry after a lost response books
            a second transaction and advances the schedule twice.

    Returns:
        {"created_count", "transactions", "skipped_existing",
        "next_due_date", "dry_run", "committed"}
    """
    return recurring.generate_recurring_occurrence(user_id, recurring_id, dry_run, idempotency_key)


@mcp.tool(tags={"recurring", "write"}, annotations={"destructiveHint": False})
def skip_recurring_occurrence(
    recurring_id: str,
    dry_run: bool = False,
    idempotency_key: str | None = None,
    user_id: str = Depends(authenticated_user_id),
) -> dict:
    """
    Advance the schedule by one period without booking anything.

    For a month the subscription is paused, a bill is waived, or the charge
    was already captured by a transaction nobody linked.

    Args:
        recurring_id: The recurring transaction's ID
        dry_run: Advance it, report it, then roll it back (default False)
        idempotency_key: Caller-chosen id that makes a retry safe. Without
            one, a retry after a lost response skips two periods.

    Returns:
        {"skipped_date", "next_due_date", "auto_generate", "dry_run",
        "committed"}
    """
    return recurring.skip_recurring_occurrence(user_id, recurring_id, dry_run, idempotency_key)


# ============================================================================
# Investment Tools
# ============================================================================


@mcp.tool(tags={"investments", "read"}, annotations={"readOnlyHint": True})
def list_holdings(
    account_id: str | None = None,
    user_id: str = Depends(authenticated_user_id),
    person_ids: list[str] | None = None,
) -> list[dict]:
    """
    List investment holdings for a user, with the latest available valuation.

    Args:
        account_id: Filter to a single investment account (optional)
        person_ids: Optional list of person UUIDs. When provided, only returns
            holdings from accounts owned by any of those people. When exactly
            one person_id is given, current_value_user_currency is
            share-weighted to that person's ownership fraction.

    Returns:
        List of holdings with symbol, quantity, latest price, and current value
        in the user's functional currency.
    """
    return investments.list_holdings(user_id, account_id, person_ids)


@mcp.tool(tags={"investments", "read"}, annotations={"readOnlyHint": True})
def get_portfolio_summary(
    user_id: str = Depends(authenticated_user_id),
    person_ids: list[str] | None = None,
) -> dict:
    """
    Get a summary of the user's investment portfolio.

    Aggregates the latest holding valuations across all active investment
    accounts (manual + brokerage).

    Args:
        person_ids: Optional list of person UUIDs. When provided, only includes
            investment accounts owned by any of those people. When exactly one
            person_id is given, values are share-weighted by that person's
            ownership fraction.

    Returns:
        Dict with currency, total_value, holdings_count, stale_valuations,
        and a per-account breakdown.
    """
    return investments.get_portfolio_summary(user_id, person_ids)


@mcp.tool(tags={"investments", "read"}, annotations={"readOnlyHint": True})
def get_portfolio_history(
    from_date: str | None = None,
    to_date: str | None = None,
    user_id: str = Depends(authenticated_user_id),
    person_ids: list[str] | None = None,
) -> list[dict]:
    """
    Get daily portfolio value history (sum across investment accounts) in
    the user's functional currency.

    Args:
        from_date: Start date, ISO YYYY-MM-DD, inclusive (optional)
        to_date: End date, ISO YYYY-MM-DD, inclusive of the whole day (optional)
        person_ids: Optional list of person UUIDs. When provided, only includes
            investment accounts owned by any of those people. When exactly one
            person_id is given, daily values are share-weighted.

    Returns:
        List of {date, value_user_currency} entries sorted by date.
    """
    return investments.get_portfolio_history(user_id, from_date, to_date, person_ids)


@mcp.tool(tags={"investments", "read"}, annotations={"readOnlyHint": True})
def search_symbol(query: str, user_id: str = Depends(authenticated_user_id)) -> list[dict]:
    """
    Search the user's existing holdings by symbol or name (case-insensitive).

    Args:
        query: Substring to match against holding symbol or name

    Returns:
        List of matching {symbol, name, currency, instrument_type} entries.
    """
    return investments.search_symbol(user_id, query)


@mcp.tool(tags={"investments", "read"}, annotations={"readOnlyHint": True})
def get_holding_trades(
    holding_id: str,
    user_id: str = Depends(authenticated_user_id),
) -> list[dict]:
    """
    Return trade-level history behind a single holding.

    Manual holdings have no trade-import data source, so this always
    returns an empty list once the holding's existence is confirmed.

    Args:
        holding_id: UUID of the holding (must belong to the authenticated user).
    """
    return investments.get_holding_trades(user_id, holding_id)


# ============================================================================
# People & Household Tools
# ============================================================================


@mcp.tool(tags={"core", "read"}, annotations={"readOnlyHint": True})
def list_people(user_id: str = Depends(authenticated_user_id)) -> list[dict]:
    """
    List all people in the user's household.

    Args:

    Returns:
        List of person dicts with id, name, kind (self|member), color.
    """
    return people_tools.list_people(user_id)


@mcp.tool(tags={"core", "read"}, annotations={"readOnlyHint": True})
def get_household_summary(
    person_ids: list[str] | None = None,
    user_id: str = Depends(authenticated_user_id),
) -> dict:
    """
    Per-person net worth breakdown across cash, investments, properties, vehicles.

    Args:
        person_ids: Optional list of person UUIDs. When provided, only returns
            entries for those specific people.

    Returns:
        Dict with a ``people`` list; each entry has person_id, name, cash,
        investments, properties, vehicles, total (all share-attributed).
    """
    return people_tools.get_household_summary(user_id, person_ids)


# ============================================================================
# Report Tools
# ============================================================================


@mcp.tool(tags={"reports", "read"}, annotations={"readOnlyHint": True})
def list_reports(user_id: str = Depends(authenticated_user_id)) -> list[dict]:
    """
    List all scheduled report newsletters for the user.

    Args:

    Returns:
        List of report dicts (id, name, frequency, schedule fields,
        recipient_emails, next_run_at, is_active, etc.)
    """
    return report_tools.list_reports(user_id)


@mcp.tool(tags={"reports", "read"}, annotations={"readOnlyHint": True})
def get_report(report_id: str, user_id: str = Depends(authenticated_user_id)) -> dict | None:
    """
    Get a single scheduled report by ID.

    Args:
        report_id: The report's ID

    Returns:
        Report dict, or None if not found / not owned by this user.
    """
    return report_tools.get_report(user_id, report_id)


@mcp.tool(tags={"reports", "write"}, annotations={"destructiveHint": False})
def create_report(
    name: str,
    frequency: str,
    recipient_emails: list[str],
    account_ids: list[str] | None = None,
    transaction_mode: str = "RECENT",
    transaction_count: int = 10,
    transaction_direction: str = "ALL",
    send_time: str = "08:00:00",
    send_day_of_week: int | None = None,
    send_day_of_month: int | None = None,
    timezone: str = "UTC",
    is_active: bool = True,
    dry_run: bool = False,
    idempotency_key: str | None = None,
    user_id: str = Depends(authenticated_user_id),
) -> dict:
    """
    Create a new scheduled report newsletter.

    Args:
        name: Display name for this report
        frequency: One of "DAILY", "WEEKLY", "BIWEEKLY", "MONTHLY"
        recipient_emails: List of email addresses to send to (at least one required)
        account_ids: Account IDs whose balances to include (optional, defaults to none)
        transaction_mode: "RECENT" (most recent N transactions) or "TOP_N"
            (largest by amount) — defaults to "RECENT"
        transaction_count: How many transactions to include, 1-100 (default 10)
        transaction_direction: "ALL", "EXPENSE", "INCOME", "INFLOW", or
            "OUTFLOW" — filters which transactions are eligible (default "ALL")
        send_time: Local send time as "HH:MM" or "HH:MM:SS" (default "08:00:00")
        send_day_of_week: Required if frequency is WEEKLY or BIWEEKLY.
            0=Monday .. 6=Sunday
        send_day_of_month: Required if frequency is MONTHLY. 1-28
        timezone: IANA timezone name, e.g. "Europe/Brussels" (default "UTC")
        is_active: Whether the report is active/scheduled (default True)
        dry_run: Preview the change and roll it back, without writing (default False)
        idempotency_key: Caller-chosen id that makes a retry safe. The same
            key with the same arguments replays the first response instead of
            writing again; the same key with different arguments is rejected.

    Returns:
        {"report": {...}, "dry_run": bool, "committed": bool}. Raises on
        validation failure (e.g. bad frequency, missing required day field,
        invalid email, unowned account_id) with a message naming the
        offending field.
    """
    return report_tools.create_report(
        user_id=user_id,
        name=name,
        frequency=frequency,
        recipient_emails=recipient_emails,
        account_ids=account_ids,
        transaction_mode=transaction_mode,
        transaction_count=transaction_count,
        transaction_direction=transaction_direction,
        send_time=send_time,
        send_day_of_week=send_day_of_week,
        send_day_of_month=send_day_of_month,
        timezone=timezone,
        is_active=is_active,
        dry_run=dry_run,
        idempotency_key=idempotency_key,
    )


@mcp.tool(tags={"reports", "write"}, annotations={"destructiveHint": False, "idempotentHint": True})
def update_report(
    report_id: str,
    name: str | None = None,
    account_ids: list[str] | None = None,
    transaction_mode: str | None = None,
    transaction_count: int | None = None,
    transaction_direction: str | None = None,
    frequency: str | None = None,
    send_time: str | None = None,
    send_day_of_week: int | None = None,
    send_day_of_month: int | None = None,
    timezone: str | None = None,
    recipient_emails: list[str] | None = None,
    is_active: bool | None = None,
    dry_run: bool = False,
    idempotency_key: str | None = None,
    user_id: str = Depends(authenticated_user_id),
) -> dict:
    """
    Update a scheduled report. Only provided (non-None) fields are changed;
    all others keep their current value.

    Changing frequency to WEEKLY/BIWEEKLY without send_day_of_week, or to
    MONTHLY without send_day_of_month, will fail — either provide the day
    field in the same call, or ensure the report already has one set.

    Args:
        report_id: The report's ID
        (see create_report for the meaning of each other field)
        dry_run: Preview the change and roll it back, without writing (default False)
        idempotency_key: Caller-chosen id that makes a retry safe. The same
            key with the same arguments replays the first response instead of
            writing again; the same key with different arguments is rejected.

    Returns:
        {"changed", "before", "after", "fields_changed", "report",
        "dry_run", "committed"}. Raises if not found or invalid.
    """
    return report_tools.update_report(
        user_id=user_id,
        report_id=report_id,
        name=name,
        account_ids=account_ids,
        transaction_mode=transaction_mode,
        transaction_count=transaction_count,
        transaction_direction=transaction_direction,
        frequency=frequency,
        send_time=send_time,
        send_day_of_week=send_day_of_week,
        send_day_of_month=send_day_of_month,
        timezone=timezone,
        recipient_emails=recipient_emails,
        is_active=is_active,
        dry_run=dry_run,
        idempotency_key=idempotency_key,
    )


@mcp.tool(tags={"reports", "write"}, annotations={"idempotentHint": True})
def delete_report(
    report_id: str,
    dry_run: bool = False,
    user_id: str = Depends(authenticated_user_id),
) -> dict:
    """
    Permanently delete a scheduled report (and its run history).

    Args:
        report_id: The report's ID
        dry_run: Report what would be destroyed without destroying it
            (default False)

    Returns:
        {"deleted_report_id", "deleted_report", "deleted_run_count",
        "dry_run", "committed"}. Raises if not found.
    """
    return report_tools.delete_report(user_id, report_id, dry_run=dry_run)


@mcp.tool(tags={"reports", "write"}, annotations={"destructiveHint": False})
def send_test_report(
    report_id: str,
    dry_run: bool = False,
    user_id: str = Depends(authenticated_user_id),
) -> dict:
    """
    Trigger an immediate test send of a report, bypassing its schedule.

    Args:
        report_id: The report's ID
        dry_run: Report who the email would reach, what subject they would
            see, and how much test-send quota is left — without sending
            anything (default False). Unlike the other dry runs this one
            writes nothing at all: a sent email cannot be rolled back.

    Returns:
        {"run": {...}} with the created (SCHEDULED, then asynchronously
        RUNNING/SUCCEEDED/FAILED) run record. With dry_run:
        {"would_send_to", "subject", "quota_remaining"}. Raises if the report
        isn't found, or if the hourly test-send quota is already spent.
    """
    return report_tools.send_test_report(user_id, report_id, dry_run=dry_run)


@mcp.tool(tags={"reports", "read"}, annotations={"readOnlyHint": True})
def list_report_runs(report_id: str, user_id: str = Depends(authenticated_user_id)) -> list[dict]:
    """
    List scheduled and executed send history for a report.

    Args:
        report_id: The report's ID

    Returns:
        List of run dicts (status, scheduled_for, started_at, finished_at,
        error_message, is_test), most recent first. Empty list if the
        report isn't found.
    """
    return report_tools.list_report_runs(user_id, report_id)


# ============================================================================
# Budget Tools
# ============================================================================


@mcp.tool(tags={"budgets", "read"}, annotations={"readOnlyHint": True})
def list_budgets(
    include_inactive: bool = True,
    include_categories: bool = True,
    user_id: str = Depends(authenticated_user_id),
) -> list[dict]:
    """
    List budgets with current-period spend, status, and pace projection.

    Each budget reports `spent`, `remaining`, `percentage`, `status`
    (on_track / near_limit / over_budget), `projected_spend` and
    `projected_status` (today's daily rate extrapolated to the period end),
    plus the period window and `daily_allowance_remaining`.

    Args:
        include_inactive: Include budgets marked inactive (default True)
        include_categories: Include the per-category breakdown on each
            budget. Pass False for a compact overview (returns
            `category_count` instead).

    Returns:
        List of budget dicts, newest first.
    """
    return budget_tools.list_budgets(user_id, include_inactive, include_categories)


@mcp.tool(tags={"budgets", "read"}, annotations={"readOnlyHint": True})
def get_budget(budget_id: str, user_id: str = Depends(authenticated_user_id)) -> dict | None:
    """
    Get a single budget with its full per-category breakdown.

    Each category entry carries its `sub_limit` (may be null — no cap of its
    own), `spent`, `remaining`, `status`, and `weight` (the share of the
    overall budget amount that sub-limit represents).

    Args:
        budget_id: The budget's ID

    Returns:
        Budget dict, or None if not found.
    """
    return budget_tools.get_budget(user_id, budget_id)


@mcp.tool(tags={"budgets", "read"}, annotations={"readOnlyHint": True})
def get_budget_summary(user_id: str = Depends(authenticated_user_id)) -> dict:
    """
    Portfolio-level view of every active budget, in the user's functional currency.

    The cheapest way to answer "how are my budgets doing?" — totals,
    over/near-limit counts, a compact row per budget, and a
    `needs_attention` list of budgets that are over, near their limit, or
    projected to bust by the end of the period.

    Returns:
        Dict with total_budgeted, total_spent, total_remaining, counts,
        `budgets`, and `needs_attention`.
    """
    return budget_tools.get_budget_summary(user_id)


@mcp.tool(tags={"budgets", "read"}, annotations={"readOnlyHint": True})
def get_budget_transactions(
    budget_id: str,
    limit: int = 50,
    period_offset: int = 0,
    category_id: str | None = None,
    user_id: str = Depends(authenticated_user_id),
) -> dict:
    """
    The transactions that make up a budget's spend, largest first.

    Use this to explain *why* a budget is over: it returns the same rows the
    spend total is computed from, so the numbers always reconcile.

    Args:
        budget_id: The budget's ID
        limit: Max transactions to return (1-200, default 50)
        period_offset: 0 = current period (default), 1 = previous period, etc.
        category_id: Restrict to one of the budget's categories (optional)

    Returns:
        Dict with the period window, `transactions`, `total_spent`,
        `total_count` and `has_more`. Raises if the budget or category
        isn't usable.
    """
    return budget_tools.get_budget_transactions(
        user_id, budget_id, limit, period_offset, category_id
    )


@mcp.tool(tags={"budgets", "read"}, annotations={"readOnlyHint": True})
def get_budget_history(
    budget_id: str, periods: int = 6, user_id: str = Depends(authenticated_user_id)
) -> dict:
    """
    Spend for a budget over the last N periods, measured against its limit.

    Averages and the breach count cover completed periods only — the current
    period is partial and is flagged with `is_current`. `suggested_amount`
    is the completed-period average plus 10% headroom: a starting point for
    resizing the budget, not an automatic change.

    Historical limit changes are not versioned in the schema, so earlier
    periods are compared against the budget's *current* amount.

    Args:
        budget_id: The budget's ID
        periods: How many periods back to include, counting the current one (1-24)

    Returns:
        Dict with `periods` (most recent first), `average_spent_completed`,
        `over_budget_period_count` and `suggested_amount`. Raises if the
        budget isn't found.
    """
    return budget_tools.get_budget_history(user_id, budget_id, periods)


@mcp.tool(tags={"budgets", "write"}, annotations={"destructiveHint": False})
def create_budget(
    name: str,
    amount: float,
    categories: list[dict] | None = None,
    currency: str = "EUR",
    period: str = "monthly",
    start_date: str | None = None,
    is_active: bool = True,
    dry_run: bool = False,
    idempotency_key: str | None = None,
    user_id: str = Depends(authenticated_user_id),
) -> dict:
    """
    Create a spending budget across one or more categories.

    Args:
        name: Budget name
        amount: Overall limit for one period, in `currency`. Must be > 0.
        categories: List of {"category_id": str, "sub_limit": float | None}.
            `sub_limit` is an optional per-category cap inside this budget;
            omit it or pass null for no cap of its own. Category IDs come
            from list_categories().
        currency: ISO code that amount and sub_limits are expressed in (default EUR)
        period: monthly (default), weekly, or yearly
        start_date: YYYY-MM-DD anchor. Only meaningful for weekly budgets,
            where it fixes the weekday the week rolls over on; monthly and
            yearly budgets always run calendar month / calendar year.
        is_active: Whether the budget counts toward summaries (default True)
        dry_run: Preview the change and roll it back, without writing (default False)
        idempotency_key: Caller-chosen id that makes a retry safe. The same
            key with the same arguments replays the first response instead of
            writing again; the same key with different arguments is rejected.

    Returns:
        {"budget": {...}, "dry_run": bool, "committed": bool}. Raises on
        invalid input.
    """
    return budget_tools.create_budget(
        user_id,
        name,
        amount,
        categories,
        currency,
        period,
        start_date,
        is_active,
        dry_run=dry_run,
        idempotency_key=idempotency_key,
    )


@mcp.tool(tags={"budgets", "write"}, annotations={"destructiveHint": False, "idempotentHint": True})
def update_budget(
    budget_id: str,
    name: str | None = None,
    amount: float | None = None,
    currency: str | None = None,
    period: str | None = None,
    start_date: str | None = None,
    is_active: bool | None = None,
    dry_run: bool = False,
    idempotency_key: str | None = None,
    user_id: str = Depends(authenticated_user_id),
) -> MutationResult:
    """
    Adjust a budget. Only the fields you pass are changed.

    Category membership is not touched here — use set_budget_categories.
    To pause or resume a budget, pass is_active.

    Args:
        budget_id: The budget's ID
        name: New name (optional)
        amount: New overall limit, must be > 0 (optional)
        currency: New ISO currency code (optional). This re-denominates the
            budget — amount and sub_limits are reinterpreted in the new
            currency as-is, they are not converted.
        period: monthly, weekly, or yearly (optional)
        start_date: YYYY-MM-DD anchor, or "" to clear it (optional)
        is_active: Activate (True) or deactivate (False) the budget (optional)
        dry_run: Preview the change and roll it back, without writing (default False)
        idempotency_key: Caller-chosen id that makes a retry safe. The same
            key with the same arguments replays the first response instead of
            writing again; the same key with different arguments is rejected.

    Returns:
        {"changed", "before", "after", "fields_changed", "budget" (with
        freshly recomputed spend), "dry_run", "committed"}. Raises on invalid
        input or an unknown budget_id.
    """
    return budget_tools.update_budget(
        user_id,
        budget_id,
        name,
        amount,
        currency,
        period,
        start_date,
        is_active,
        dry_run=dry_run,
        idempotency_key=idempotency_key,
    )


@mcp.tool(tags={"budgets", "write"}, annotations={"destructiveHint": False, "idempotentHint": True})
def set_budget_categories(
    budget_id: str,
    categories: list[dict],
    mode: str = "replace",
    dry_run: bool = False,
    user_id: str = Depends(authenticated_user_id),
) -> dict:
    """
    Reorganize which categories a budget covers, and their sub-limits.

    Args:
        budget_id: The budget's ID
        categories: List of {"category_id": str, "sub_limit": float | null}.
            For mode="remove" only category_id is read.
        mode: How to apply the list —
            "replace" (default): the list becomes the entire membership;
                categories not listed are dropped.
            "add": insert the listed categories, and update the sub_limit of
                any already present. Everything else is left alone.
            "remove": drop the listed categories from the budget.
        dry_run: Preview the change and roll it back, without writing (default False)

    Returns:
        {"changed", "added": [...], "removed": [...], "updated": [...],
         "budget": {...}, "dry_run", "committed"}. Raises on invalid input or
        an unknown budget_id.
    """
    return budget_tools.set_budget_categories(user_id, budget_id, categories, mode, dry_run=dry_run)


@mcp.tool(tags={"budgets", "write"}, annotations={"idempotentHint": True})
def delete_budget(
    budget_id: str,
    dry_run: bool = False,
    user_id: str = Depends(authenticated_user_id),
) -> dict:
    """
    Permanently delete a budget and its category memberships.

    Transactions are untouched — a budget is only a lens over them. To stop
    a budget counting without losing it, use update_budget(is_active=False).

    Args:
        budget_id: The budget's ID
        dry_run: Report what would be destroyed without destroying it
            (default False)

    Returns:
        {"deleted_budget": {...}, "dry_run": bool, "committed": bool}. The
        snapshot names the budget and the category memberships that go with
        it. Raises if the budget isn't found.
    """
    return budget_tools.delete_budget(user_id, budget_id, dry_run=dry_run)


# ============================================================================
# Toolsets
# ============================================================================


async def load_toolset(names: list[str], ctx: Context) -> dict:
    # Docstring is assigned below so the menu of toolsets has one definition
    # (app/mcp/toolsets.py) rather than a copy here that drifts from it.
    try:
        requested = toolsets.parse(",".join(names))
    except toolsets.UnknownToolset as exc:
        raise ToolError(str(exc)) from exc

    if not requested:
        # An empty list, or nothing but "core", which is already on. Reporting
        # that as loaded would be a lie the agent then acts on.
        raise ToolError(
            "Name at least one toolset to load. Available: "
            + ", ".join(sorted(toolsets.OPTIONAL))
            + " (or 'all'). `core` is always loaded."
        )

    await toolsets.enable(ctx, requested)
    loaded = await toolsets.already_loaded(ctx) or requested

    return {
        "loaded": sorted(loaded),
        "now_available": sorted(await _visible_tool_names()),
        "other_toolsets": {
            name: text
            for name, text in toolsets.TOOLSETS.items()
            if name in toolsets.OPTIONAL and name not in loaded
        },
    }


load_toolset.__doc__ = f"""Load a group of tools that is not visible yet.

    The tools you can see are the ones every session starts with. Budgets,
    recurring bills, investments, scheduled reports and transaction editing
    are grouped behind this call so their schemas cost nothing until they are
    wanted. Reach for it as soon as the user's request names one of those
    areas -- before telling them it is unsupported.

{chr(10).join("    " + line for line in toolsets.describe().splitlines())}

    Loading is additive and lasts for the session; loading the same group
    twice is harmless. Pass ["all"] for everything.

    Args:
        names: Toolsets to load, e.g. ["budgets", "recurring"]

    Returns:
        {{"loaded", "now_available", "other_toolsets"}}. `loaded` is every
        toolset this session has, not only the ones this call added. The new
        tools also arrive as a tools/list_changed notification;
        `now_available` is there for clients that do not act on one.
    """

load_toolset = mcp.tool(tags={toolsets.CORE, "read"}, annotations={"readOnlyHint": True})(
    load_toolset
)


async def _visible_tool_names() -> list[str]:
    """Tool names visible to the session calling right now.

    `run_middleware=False` because this is a read of the surface from inside a
    tool, not a `tools/list` from the client: running the middleware chain
    again would bill the call twice against the rate limit and log a listing
    that never happened.
    """
    return [tool.name for tool in await mcp.list_tools(run_middleware=False)]


# Everything outside `core` starts hidden. This is a *server* transform, so it
# is the baseline every session begins from; the session rules written by
# `toolsets.enable` -- from load_toolset, from the connect-time parameter, or
# from ToolsetSelection autoloading on a call -- override it for that session
# alone.
#
# FastMCP refuses a call to a hidden tool outright ("unknown tool"), which
# would make this a trap for a client resuming a conversation with the tool
# name still in its history. ToolsetSelection.on_call_tool loads the toolset
# instead, so the listing is a default rather than a wall.
mcp.add_transform(Visibility(False, tags=set(toolsets.OPTIONAL), components={"tool"}))


# Resources and prompts. Both are additive -- no tool changes behaviour
# because these exist -- but they are what lets the instructions string above
# stay short: the field semantics live in syllogic://schema and the workflows
# live in the prompts, instead of being paid for on every session.
mcp_resources.register(mcp)
mcp_prompts.register(mcp)


# Registration order is call order. ToolsetSelection is first because it
# decides what the rest of the session can see; then throttle before doing the
# work, then log what actually ran, so the limiter sees a request the logger
# never records as a completed call.
mcp.add_middleware(ToolsetSelection())
mcp.add_middleware(PerUserRateLimit())
mcp.add_middleware(ToolCallLogger())
