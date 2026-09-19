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


MAJOR_UNITS = "In major units (euros, not cents); see the sibling `currency`."


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
        default=None, description="User override; takes precedence over `category_system_id`."
    )
    category_system_id: str | None = Field(
        default=None, description="AI assignment; used only when `category_id` is null."
    )
    category_name: str | None = Field(default=None, description="The effective category.")
    booked_at: str | None = Field(default=None, description="RFC-3339 instant.")
    pending: bool | None = None
    transaction_type: str | None = Field(default=None, description='"debit" out, "credit" in.')
    include_in_analytics: bool | None = Field(
        default=None, description="False for own-account transfers, which are not spending."
    )
    recurring_transaction_id: str | None = None


class TransactionPage(BaseModel):
    """A page of transactions, with everything needed to ask for the next."""

    transactions: list[TransactionOut] = Field(default_factory=list)
    page: int | None = Field(default=None, description="Null when paging by cursor.")
    limit: int | None = None
    next_cursor: str | None = Field(
        default=None, description="Pass as `cursor` for the next page; null when exhausted."
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
    has_more: bool = Field(description="Keep paging while true.")
    total_count: int | None = Field(
        default=None,
        description="Total matches; null while paging by cursor. Read it from page one.",
    )
    next_cursor: str | None = None
    query_counts: dict[str, int] | None = Field(
        default=None, description="Matches per term, when `queries` was used."
    )


class CategoryAmountOut(BaseModel):
    """One category's total, for `get_amounts_by_category`."""

    category_id: str | None = Field(default=None, description="Null for the Uncategorized bucket.")
    category_name: str
    category_color: str | None = None
    total: float = Field(description=MAJOR_UNITS + " Always positive.")
    currency: str = Field(description="The user's functional currency; totals convert into it.")
    count: int = Field(description="Transactions behind this total.")
    unconverted_transaction_count: int = Field(
        description=(
            "Rows left out of `total` for want of an exchange rate. Non-zero "
            "means the total is an undercount; report it as one."
        )
    )
    merchant_count: int | None = Field(
        default=None, description="Distinct merchants; expenses only."
    )
    period: str | None = Field(
        default=None,
        description="Bucket start YYYY-MM-DD, only when `group_by` was set.",
    )


class AccountOut(BaseModel):
    """One account."""

    id: str
    name: str
    account_type: str | None = None
    asset_class: str | None = Field(
        default=None, description='From account_type: "cash", "investment", "property", ...'
    )
    institution: str | None = None
    currency: str | None = Field(default=None, description="The account's own currency.")
    balance_available: float | None = Field(default=None, description=MAJOR_UNITS)
    balance_current: float | None = Field(default=None, description=MAJOR_UNITS)
    functional_balance: float | None = Field(
        default=None,
        description="In the user's functional currency; null if no rate was on record, not zero.",
    )
    is_active: bool | None = None

    model_config = {"extra": "allow"}


class CategoryOut(BaseModel):
    """One category."""

    id: str
    name: str
    category_type: str | None = Field(default=None, description='"expense", "income", "transfer".')
    color: str | None = None
    icon: str | None = None
    description: str | None = None
    categorization_instructions: str | None = Field(
        default=None, description="Rules the user taught the system for this category."
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
    dry_run: bool = Field(description="True if this was a preview; nothing was written.")
    committed: bool = Field(description="False for a preview or a rolled-back write.")

    model_config = {"extra": "allow"}
