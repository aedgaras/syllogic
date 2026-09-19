"""MCP prompts: the workflows that were prose in the instructions string.

Each of these was a worked example sitting in `instructions`, paid for in
tokens at the start of every session whether or not the user was going to ask
for it. As a prompt it costs nothing until it is invoked, and it arrives with
the user's actual arguments filled in rather than as a template to adapt.

The sequences themselves are not new. What is new is that an agent can be
handed one instead of reconstructing it from a paragraph.
"""

from __future__ import annotations


def register(mcp) -> None:
    """Attach the prompts to a FastMCP server."""

    @mcp.prompt(
        name="categorize_uncategorized",
        description="Work through uncategorized transactions in bulk, safely.",
    )
    def categorize_uncategorized(limit: int = 100, account_id: str | None = None) -> str:
        scope = f" in account {account_id}" if account_id else ""
        return f"""\
Categorize up to {limit} uncategorized transactions{scope}.

1. Read `syllogic://categories` for the available categories and the
   `categorization_instructions` the user has already written. Those
   instructions are rules the user has taught the system -- follow them rather
   than inventing your own.
2. `list_transactions(uncategorized=True, limit={limit}{", account_id=" + repr(account_id) if account_id else ""})`
   to see what needs doing.
3. Group them by merchant. `search_transactions(queries=[...],
   match_mode="word", ids_only=True)` finds every transaction for a set of
   merchants in one call -- use `match_mode="word"` so "Action" does not match
   "Transaction". The response's `query_counts` tells you which spellings
   actually matched anything.
4. For each group, call
   `bulk_update_transaction_categories(category_id=..., transaction_ids=[...],
   dry_run=True)` and **show the user the `sample_changes`**. Each one carries
   `before` and `after`.
5. Only after they agree, repeat the call without `dry_run`.

Do not skip step 4. These are the user's records and they have not seen the
rows you are about to change.

If a merchant genuinely belongs in a category the user's instructions do not
cover, say so and propose adding it via
`update_category(categorization_instructions=...)` -- that makes the rule
stick for future imports instead of needing you again next month."""

    @mcp.prompt(
        name="month_end_close",
        description="Review one month: spending, income, budgets and anything unresolved.",
    )
    def month_end_close(month: str) -> str:
        return f"""\
Close out {month} (YYYY-MM).

1. `get_monthly_cashflow()` and `get_financial_summary(from_date="{month}-01",
   to_date=<last day of {month}>)` for the shape of the month. Both dates are
   inclusive.
2. `get_amounts_by_category(direction="expense", include_uncategorized=True)`.
   If the
   Uncategorized bucket is not empty, that is the first thing to raise -- every
   other number in this review is understated by whatever is in it.
3. Check `unconverted_transaction_count` on each aggregate. Non-zero means
   transactions were excluded for want of an exchange rate, so the totals are
   an undercount. Say so explicitly rather than reporting them as exact.
4. `get_budget_summary()` for how the budgets landed, then
   `get_budget_transactions(budget_id, period_offset=1)` on anything that went
   over, so you can name what drove it.
5. `get_recurring_summary()` for the fixed monthly load, and flag anything new
   or anything that changed price.

Report in the user's functional currency, and say which currency that is."""

    @mcp.prompt(
        name="budget_review",
        description="Check every budget's pace and propose adjustments grounded in history.",
    )
    def budget_review(period_offset: int = 0) -> str:
        which = "the current period" if period_offset == 0 else f"{period_offset} period(s) ago"
        return f"""\
Review the budgets for {which}.

1. `get_budget_summary()` first -- it is the cheapest call and its
   `needs_attention` list is usually the whole answer.
2. For each budget in that list, `get_budget(budget_id)` for the per-category
   breakdown and `get_budget_transactions(budget_id, period_offset={period_offset})`
   for the transactions actually driving the spend, largest first.
3. `get_budget_history(budget_id)` before proposing any change to a limit. It
   carries `average_spent_completed` and a `suggested_amount` (the average plus
   10% headroom). A limit set from one bad month is how a budget stops meaning
   anything.
4. Propose changes with `update_budget(budget_id, amount=..., dry_run=True)`
   and show the result. Apply only once the user agrees.

Distinguish "over budget" from "projected to go over" -- the second is a pace
projection and the month may still recover."""

    @mcp.prompt(
        name="spending_investigation",
        description="Explain why spending in one category moved.",
    )
    def spending_investigation(category_id: str, months: int = 6) -> str:
        return f"""\
Investigate spending in category {category_id} over the last {months} months.

1. `get_amounts_by_category(direction="expense", group_by="month")` for the
   trend -- one call, one row per month. Both date bounds are inclusive.
2. `get_top_merchants(category_id="{category_id}")` for where the money went.
3. `search_transactions(category_id="{category_id}", sort_by="abs_amount_desc")`
   for the largest individual items -- a category that jumped usually jumped
   because of two or three transactions, not a general drift.
4. `list_recurring_transactions()` to separate the fixed commitments from the
   discretionary spend. A category that looks like it grew may just have gained
   a subscription.

Before concluding anything: check whether the category has transactions whose
`category_id` was set by the user versus assigned by the AI. A jump can be an
artifact of recategorization rather than of spending. The effective category is
`category_id` when set, `category_system_id` otherwise."""
