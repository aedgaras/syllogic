"""Output schemas for the MCP tools.

Every tool used to return a bare `dict`, so every tool published an
`outputSchema` of `{"type": "object", "additionalProperties": true}` -- which
is to say, nothing. An agent had to call a tool to discover the shape of that
tool's response, and then guess at which fields were optional.

The models here are deliberately thin. They are a contract about field names,
types and units, not a validation layer: the tools still build plain dicts and
FastMCP coerces them on the way out. That keeps the query code readable and
puts the schema where a client can actually see it.

What every amount field says, and why it is worth the repetition: amounts are
**major units** (euros, not cents) and the currency is the sibling `currency`
field, never inferred. Getting either wrong produces a number that is out by
a hundred, or in the wrong currency, and looks entirely reasonable either way.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


MAJOR_UNITS = (
    "Decimal amount in major units (euros, not cents). Currency is the sibling `currency` field."
)


class TransactionOut(BaseModel):
    """One transaction, as the list and search tools return it."""

    id: str
    account_id: str
    account_name: str | None = None
    amount: float = Field(description=MAJOR_UNITS)
    currency: str | None = Field(default=None, description="ISO code for `amount`.")
    description: str | None = None
    merchant: str | None = None
    category_id: str | None = Field(
        default=None,
        description=(
            "The user's category override. Takes precedence over "
            "`category_system_id`; null means the user has never corrected "
            "this transaction."
        ),
    )
    category_system_id: str | None = Field(
        default=None,
        description=(
            "The AI's category assignment, made at import. Used only when `category_id` is null."
        ),
    )
    category_name: str | None = Field(default=None, description="Name of the effective category.")
    booked_at: str | None = Field(default=None, description="RFC-3339 instant.")
    pending: bool | None = None
    transaction_type: str | None = Field(
        default=None, description='"debit" (money out) or "credit" (money in).'
    )
    include_in_analytics: bool | None = Field(
        default=None,
        description="False for transfers between the user's own accounts, which are not spending.",
    )
    recurring_transaction_id: str | None = None


class TransactionPage(BaseModel):
    """A page of transactions, with everything needed to ask for the next."""

    transactions: list[TransactionOut] = Field(default_factory=list)
    page: int | None = Field(
        default=None, description="Null when paging by cursor rather than page number."
    )
    limit: int | None = None
    next_cursor: str | None = Field(
        default=None, description="Pass as `cursor` for the next page. Null when exhausted."
    )


class TransactionSearchPage(BaseModel):
    """A page of search results.

    `transactions` and `transaction_ids` are alternatives, not both: the
    second is what `ids_only=True` returns, and it exists because a bulk
    recategorization only needs the ids and paying for the rest is what makes
    the workflow expensive.
    """

    transactions: list[TransactionOut] | None = None
    transaction_ids: list[str] | None = None
    page: int | None = None
    limit: int | None = None
    has_more: bool = Field(
        description="True if more results exist. Keep paging while this is true."
    )
    total_count: int | None = Field(
        default=None,
        description=(
            "Total matches. Null while paging by cursor, where the count "
            "would re-scan on every page; read it from the first response."
        ),
    )
    next_cursor: str | None = None
    query_counts: dict[str, int] | None = Field(
        default=None,
        description="Matches per search term, when `queries` was used.",
    )


class CategoryAmountOut(BaseModel):
    """One category's total, for `get_amounts_by_category`."""

    category_id: str | None = Field(default=None, description="Null for the Uncategorized bucket.")
    category_name: str
    category_color: str | None = None
    total: float = Field(description=MAJOR_UNITS + " Always positive.")
    currency: str = Field(
        description="The user's functional currency; totals are converted into it."
    )
    count: int = Field(description="Transactions behind this total.")
    unconverted_transaction_count: int = Field(
        description=(
            "Transactions excluded from `total` because no exchange rate was "
            "on record. Non-zero means the total is an undercount, and should "
            "be reported as one rather than as exact."
        )
    )
    merchant_count: int | None = Field(
        default=None, description="Distinct merchants. Expenses only."
    )
    period: str | None = Field(
        default=None,
        description=(
            "Start of the bucket as YYYY-MM-DD, present only when `group_by` "
            "was set. One row per category per period."
        ),
    )


class AccountOut(BaseModel):
    """One account."""

    id: str
    name: str
    account_type: str | None = None
    asset_class: str | None = Field(
        default=None, description='Derived from account_type: "cash", "investment", "property", ...'
    )
    institution: str | None = None
    currency: str | None = Field(default=None, description="The account's own currency.")
    balance_available: float | None = Field(default=None, description=MAJOR_UNITS)
    balance_current: float | None = Field(default=None, description=MAJOR_UNITS)
    functional_balance: float | None = Field(
        default=None,
        description=(
            "Balance in the user's functional currency. Null when no exchange "
            "rate was on record -- null is not zero."
        ),
    )
    is_active: bool | None = None

    model_config = {"extra": "allow"}


class CategoryOut(BaseModel):
    """One category."""

    id: str
    name: str
    category_type: str | None = Field(
        default=None, description='"expense", "income" or "transfer".'
    )
    color: str | None = None
    icon: str | None = None
    description: str | None = None
    categorization_instructions: str | None = Field(
        default=None,
        description="Rules the user has taught the system for this category.",
    )
    parent_id: str | None = None
    is_system: bool | None = None
    created_at: str | None = None


class MutationResult(BaseModel):
    """What a single-entity write reports.

    `changed: false` with equal `before` and `after` is a no-op, and saying
    "already set" is the correct thing to tell the user -- not claiming an
    edit that did not happen.
    """

    changed: bool
    before: dict = Field(description="Tracked fields as they were.")
    after: dict = Field(description="The same fields afterwards.")
    fields_changed: list[str] = Field(default_factory=list)
    dry_run: bool = Field(description="True if this was a preview and nothing was written.")
    committed: bool = Field(description="False for a preview, or if the write was rolled back.")

    model_config = {"extra": "allow"}
