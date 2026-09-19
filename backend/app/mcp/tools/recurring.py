"""Recurring transaction tools for the MCP server.

A recurring transaction is one definition doing two jobs, and a caller has
to know which one it is looking at:

* **A label.** Rows created by `subscription_detector.py` leave
  `next_due_date` null. They group existing transactions under "Netflix" and
  feed the subscription totals; nothing is ever written from them.
* **A schedule.** With `next_due_date` set and `auto_generate` on, the daily
  `check_due_recurring_transactions` beat materializes a real transaction on
  each due date and advances the definition to the next one
  (`services/recurring_transaction_generator.py`).

The write tools here cover both, and the validation mirrors the web app
(`frontend/lib/actions/subscriptions.ts` +
`frontend/features/subscriptions/domain/rules.ts`) so an agent cannot create
a subscription the user could not have created in the UI.

Failures raise ToolError; a returned value means the write happened.
get_db() does not auto-rollback, so every mutation path rolls back
explicitly before raising.
"""

from __future__ import annotations

from contextlib import contextmanager
from datetime import date
from decimal import Decimal
from typing import Optional
from uuid import UUID

from sqlalchemy.orm import Session, joinedload

from app.mcp.dependencies import get_db, require_uuid, validate_uuid
from app.mcp.errors import (
    invalid_enum,
    invalid_format,
    missing_argument,
    not_found,
    out_of_range,
    raise_database_error,
)
from app.mcp.tools._currency import convert_or_none, user_currency
from app.mcp.tools._writes import (
    mutation_result,
    preview_or_commit,
    preview_session,
    remember,
    replay,
    snapshot,
)
from app.models import Account, Category, RecurringTransaction, Transaction
from app.services.recurring_transaction_generator import generate_due_transactions
from app.services.recurring_transaction_schedule_service import (
    VALID_FREQUENCIES,
    compute_next_due_date,
)

# The web app's form caps importance at 3 even though the column comments
# say 1-5 and get_recurring_summary buckets five levels. Writes go through
# the stricter rule: an agent should not be able to create a subscription
# the user could not edit afterwards in the UI.
MIN_IMPORTANCE = 1
MAX_IMPORTANCE = 3

# Snapshotted before and after an update, so a write that changes nothing
# says so instead of reporting success.
EDITABLE_FIELDS = (
    "name",
    "merchant",
    "amount",
    "is_variable_amount",
    "currency",
    "account_id",
    "category_id",
    "importance",
    "frequency",
    "is_active",
    "description",
    "next_due_date",
    "end_date",
    "auto_generate",
)


def _serialize(r: RecurringTransaction) -> dict:
    """One shape for reads and writes alike.

    The schedule fields are in here because a tool that can turn
    auto-generation on has to be able to show whether it is on.
    """
    return {
        "id": str(r.id),
        "name": r.name,
        "merchant": r.merchant,
        "amount": float(r.amount),
        "is_variable_amount": bool(r.is_variable_amount),
        "currency": r.currency,
        "frequency": r.frequency,
        "importance": r.importance,
        "is_active": r.is_active,
        "description": r.description,
        "account_id": str(r.account_id) if r.account_id else None,
        "account_name": r.account.name if r.account else None,
        "category_id": str(r.category_id) if r.category_id else None,
        "category_name": r.category.name if r.category else None,
        "next_due_date": r.next_due_date.isoformat() if r.next_due_date else None,
        "end_date": r.end_date.isoformat() if r.end_date else None,
        "auto_generate": bool(r.auto_generate),
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    }


def list_recurring_transactions(user_id: str, is_active: Optional[bool] = None) -> list[dict]:
    """
    List recurring transactions (subscriptions/bills) for a user.

    Args:
        user_id: The user's ID
        is_active: Filter by active status (optional, defaults to showing all)

    Returns:
        List of recurring transactions, including the schedule fields
        (`next_due_date`, `end_date`, `auto_generate`) that say whether a
        definition is a label only or actually books transactions.
    """
    with get_db() as db:
        query = (
            db.query(RecurringTransaction)
            .filter(RecurringTransaction.user_id == user_id)
            .options(
                joinedload(RecurringTransaction.category),
                joinedload(RecurringTransaction.account),
            )
        )

        if is_active is not None:
            query = query.filter(RecurringTransaction.is_active == is_active)

        recurring = query.order_by(RecurringTransaction.name).all()

        return [_serialize(r) for r in recurring]


def get_recurring_transaction(user_id: str, recurring_id: str) -> dict | None:
    """
    Get a single recurring transaction by ID.

    Args:
        user_id: The user's ID
        recurring_id: The recurring transaction's ID

    Returns:
        Recurring transaction dictionary or None if not found
    """
    recurring_uuid = validate_uuid(recurring_id)
    if not recurring_uuid:
        return None

    with get_db() as db:
        recurring = (
            db.query(RecurringTransaction)
            .filter(
                RecurringTransaction.id == recurring_uuid, RecurringTransaction.user_id == user_id
            )
            .options(joinedload(RecurringTransaction.category))
            .options(joinedload(RecurringTransaction.account))
            .first()
        )

        if not recurring:
            return None

        return _serialize(recurring)


def get_recurring_summary(user_id: str) -> dict:
    """
    Get a summary of recurring transactions (subscriptions/bills).

    Args:
        user_id: The user's ID

    Returns:
        Summary with totals by frequency and overall statistics. Every total
        is stated in `currency` (the user's functional currency);
        `unconverted_count` is how many subscriptions were left out of the
        totals because no exchange rate was on record for them.
    """
    with get_db() as db:
        functional_currency = user_currency(db, user_id)
        recurring = (
            db.query(RecurringTransaction)
            .filter(RecurringTransaction.user_id == user_id, RecurringTransaction.is_active == True)
            .all()
        )

        # Calculate monthly equivalent for each frequency
        frequency_multipliers = {
            "weekly": 4.33,  # ~4.33 weeks per month
            "biweekly": 2.17,  # ~2.17 biweeks per month
            "monthly": 1,
            "quarterly": 0.33,  # 1/3 of a quarter
            "yearly": 0.083,  # 1/12 of a year
        }

        total_monthly = 0
        unconverted_count = 0
        by_frequency = {}
        by_importance = {1: [], 2: [], 3: [], 4: [], 5: []}

        for r in recurring:
            multiplier = frequency_multipliers.get(r.frequency, 1)

            # RecurringTransaction has no stored functional_amount, so the
            # conversion happens here. A row with no rate on record is
            # counted and skipped rather than added raw: a $20/month
            # subscription folded into a EUR total is a wrong number that
            # looks exactly like a right one.
            amount = convert_or_none(
                db, float(r.amount), r.currency or functional_currency, functional_currency
            )
            if amount is None:
                unconverted_count += 1
                continue

            monthly_amount = amount * multiplier
            total_monthly += monthly_amount

            # Group by frequency
            if r.frequency not in by_frequency:
                by_frequency[r.frequency] = {"count": 0, "total": 0, "monthly_equivalent": 0}
            by_frequency[r.frequency]["count"] += 1
            by_frequency[r.frequency]["total"] += amount
            by_frequency[r.frequency]["monthly_equivalent"] += monthly_amount

            # Group by importance
            importance = r.importance or 3
            if importance in by_importance:
                by_importance[importance].append(
                    {
                        "name": r.name,
                        "amount": round(amount, 2),
                        "currency": functional_currency,
                        "native_amount": float(r.amount),
                        "native_currency": r.currency,
                        "frequency": r.frequency,
                    }
                )

        for entry in by_frequency.values():
            entry["total"] = round(entry["total"], 2)
            entry["monthly_equivalent"] = round(entry["monthly_equivalent"], 2)

        return {
            "total_active": len(recurring),
            "currency": functional_currency,
            "total_monthly_cost": round(total_monthly, 2),
            "total_yearly_cost": round(total_monthly * 12, 2),
            "unconverted_count": unconverted_count,
            "by_frequency": by_frequency,
            "by_importance": {k: v for k, v in by_importance.items() if v},
        }


# ============================================================================
# Validation and lookup
# ============================================================================


def _validate_amount(amount: float) -> None:
    """The typical charge. Zero or negative is rejected, sign is implied.

    A definition stores the charge as a positive number; the generator
    decides the sign from the category type (income -> credit, otherwise
    debit), so "-15" here would produce a +15 income row.
    """
    try:
        value = float(amount)
    except (TypeError, ValueError):
        raise invalid_format("amount", amount, "a number", example="15.99") from None
    if value != value or value in (float("inf"), float("-inf")):
        raise invalid_format("amount", amount, "a finite number", example="15.99")
    if value <= 0:
        raise out_of_range("amount", amount, minimum="greater than 0")


def _validate_importance(importance: int) -> None:
    if not isinstance(importance, int) or isinstance(importance, bool):
        raise invalid_format("importance", importance, "an integer", example="3")
    if importance < MIN_IMPORTANCE or importance > MAX_IMPORTANCE:
        raise out_of_range("importance", importance, minimum=MIN_IMPORTANCE, maximum=MAX_IMPORTANCE)


def _validate_frequency(frequency: str) -> None:
    if frequency not in VALID_FREQUENCIES:
        raise invalid_enum("frequency", frequency, VALID_FREQUENCIES)


def _parse_date(value: Optional[str], param: str) -> Optional[date]:
    """YYYY-MM-DD into a date. An empty string means "clear this"."""
    if value is None or value == "":
        return None
    try:
        return date.fromisoformat(value)
    except (TypeError, ValueError):
        raise invalid_format(
            param,
            value,
            "a YYYY-MM-DD date",
            example="2026-10-01",
            hint='Pass "" to clear it.',
        ) from None


def _validate_schedule(auto_generate: bool, next_due: Optional[date], end: Optional[date]) -> None:
    """The two rules the subscription form enforces, on the merged state.

    Checked against what the row will look like after the write, not against
    the arguments, so an update that switches auto-generation on without a
    due date is caught the same way a create would be.
    """
    if auto_generate and next_due is None:
        raise missing_argument(
            "next_due_date",
            "auto_generate needs a first due date to count from",
        )
    if end is not None and next_due is not None and end < next_due:
        raise out_of_range("end_date", end.isoformat(), minimum=next_due.isoformat())


def _candidates(db: Session, user_id: str) -> list[tuple[str, str]]:
    """(name, id) pairs for a not_found message, from the caller's session."""
    return [
        (r.name, str(r.id))
        for r in db.query(RecurringTransaction)
        .filter(RecurringTransaction.user_id == user_id)
        .order_by(RecurringTransaction.name)
        .all()
    ]


def _load(db: Session, user_id: str, recurring_uuid: UUID) -> RecurringTransaction:
    recurring = (
        db.query(RecurringTransaction)
        .filter(
            RecurringTransaction.id == recurring_uuid,
            RecurringTransaction.user_id == user_id,
        )
        .options(
            joinedload(RecurringTransaction.category),
            joinedload(RecurringTransaction.account),
        )
        .first()
    )
    if not recurring:
        raise not_found(
            "recurring transaction",
            str(recurring_uuid),
            candidates=_candidates(db, user_id),
            tool="list_recurring_transactions",
        )
    return recurring


def _require_account(db: Session, user_id: str, account_id: str) -> UUID:
    account_uuid = require_uuid(account_id, "account_id")
    owned = (
        db.query(Account.id).filter(Account.id == account_uuid, Account.user_id == user_id).first()
    )
    if not owned:
        raise not_found(
            "account",
            account_id,
            candidates=[
                (a.name, str(a.id))
                for a in db.query(Account).filter(Account.user_id == user_id).all()
            ],
            tool="list_accounts",
        )
    return account_uuid


def _require_category(db: Session, user_id: str, category_id: str) -> UUID:
    category_uuid = require_uuid(category_id, "category_id")
    owned = (
        db.query(Category.id)
        .filter(Category.id == category_uuid, Category.user_id == user_id)
        .first()
    )
    if not owned:
        raise not_found("category", category_id, tool="list_categories")
    return category_uuid


def _duplicate_name(
    db: Session,
    user_id: str,
    account_uuid: UUID,
    name: str,
    exclude_id: Optional[UUID] = None,
) -> bool:
    """The web app's uniqueness rule: one name per account, per user."""
    query = db.query(RecurringTransaction.id).filter(
        RecurringTransaction.user_id == user_id,
        RecurringTransaction.account_id == account_uuid,
        RecurringTransaction.name == name,
    )
    if exclude_id is not None:
        query = query.filter(RecurringTransaction.id != exclude_id)
    return query.first() is not None


@contextmanager
def _session(dry_run: bool):
    """A normal session, or one whose writes are undone on exit.

    `generate_due_transactions` commits internally -- twice, and then runs
    the balance recalculation -- so a preview cannot be built by withholding
    a commit. The preview session rolls back the transaction the generator
    committed into instead, which keeps the generator path byte-identical
    between a real call and a previewed one.
    """
    if dry_run:
        with preview_session() as db:
            yield db
    else:
        with get_db() as db:
            yield db


# ============================================================================
# Mutation tools
# ============================================================================


def create_recurring_transaction(
    user_id: str,
    name: str,
    amount: float,
    account_id: str,
    frequency: str,
    merchant: Optional[str] = None,
    currency: str = "EUR",
    category_id: Optional[str] = None,
    importance: int = 3,
    description: Optional[str] = None,
    is_variable_amount: bool = False,
    next_due_date: Optional[str] = None,
    end_date: Optional[str] = None,
    auto_generate: bool = False,
    is_active: bool = True,
    dry_run: bool = False,
    idempotency_key: Optional[str] = None,
) -> dict:
    """
    Create a recurring transaction (subscription or bill).

    Args:
        user_id: The user's ID
        name: What the subscription is called. Unique per account.
        amount: The typical charge, as a positive number. The sign is
            derived from the category type when a transaction is booked.
        account_id: The account the charge lands on, from list_accounts()
        frequency: weekly, biweekly, monthly, quarterly, or yearly
        merchant: Merchant name for matching bank rows (optional)
        currency: ISO code for `amount` (default EUR)
        category_id: Category from list_categories() (optional). An income
            category makes generated rows credits instead of debits.
        importance: 1-3, how essential this is (default 3)
        description: Free-text note (optional)
        is_variable_amount: True when the charge varies month to month;
            `amount` is then an estimate and duplicate matching stops
            comparing amounts (default False)
        next_due_date: YYYY-MM-DD of the next charge. Required for
            auto_generate; without it the definition is a label only.
        end_date: YYYY-MM-DD after which the schedule stops (optional)
        auto_generate: Book a real transaction on every due date (default
            False). The daily beat does this at 05:00 UTC.
        is_active: Whether it counts toward subscription totals (default True)
        dry_run: Create it, report it, then roll it back (default False)
        idempotency_key: Caller-chosen id making a retry safe. The same key
            with the same arguments replays the first response instead of
            creating a second subscription; the same key with different
            arguments is rejected.

    Returns:
        {"recurring_transaction": {...}, "dry_run": bool, "committed": bool}.
        Raises ToolError on invalid input.
    """
    if not name or not name.strip():
        raise missing_argument("name", "a recurring transaction needs a non-empty name")
    _validate_amount(amount)
    _validate_frequency(frequency)
    _validate_importance(importance)
    parsed_next_due = _parse_date(next_due_date, "next_due_date")
    parsed_end = _parse_date(end_date, "end_date")
    _validate_schedule(auto_generate, parsed_next_due, parsed_end)

    arguments = {
        "name": name,
        "amount": amount,
        "account_id": account_id,
        "frequency": frequency,
        "merchant": merchant,
        "currency": currency,
        "category_id": category_id,
        "importance": importance,
        "description": description,
        "is_variable_amount": is_variable_amount,
        "next_due_date": next_due_date,
        "end_date": end_date,
        "auto_generate": auto_generate,
        "is_active": is_active,
    }

    with get_db() as db:
        # A dry run takes no key: it is a question, not a call to remember.
        stored, digest = replay(
            db,
            user_id,
            "create_recurring_transaction",
            None if dry_run else idempotency_key,
            arguments,
        )
        if stored is not None:
            return stored

        account_uuid = _require_account(db, user_id, account_id)
        category_uuid = _require_category(db, user_id, category_id) if category_id else None

        clean_name = name.strip()
        if _duplicate_name(db, user_id, account_uuid, clean_name):
            raise invalid_format(
                "name",
                clean_name,
                "a name not already used on this account",
                hint="Call list_recurring_transactions() to see what exists.",
            )

        try:
            recurring = RecurringTransaction(
                user_id=user_id,
                account_id=account_uuid,
                name=clean_name,
                merchant=(merchant or "").strip() or None,
                amount=Decimal(str(amount)),
                is_variable_amount=is_variable_amount,
                currency=(currency or "EUR").upper(),
                category_id=category_uuid,
                importance=importance,
                frequency=frequency,
                is_active=is_active,
                description=(description or "").strip() or None,
                next_due_date=parsed_next_due,
                end_date=parsed_end,
                auto_generate=auto_generate,
            )
            db.add(recurring)
            db.flush()

            response = preview_or_commit(
                db,
                dry_run,
                lambda: {"recurring_transaction": _serialize(_load(db, user_id, recurring.id))},
            )
        except Exception as e:  # noqa: BLE001
            db.rollback()
            raise_database_error("create_recurring_transaction", e)

        if not dry_run:
            remember(db, user_id, "create_recurring_transaction", idempotency_key, digest, response)
        return response


def update_recurring_transaction(
    user_id: str,
    recurring_id: str,
    name: Optional[str] = None,
    amount: Optional[float] = None,
    account_id: Optional[str] = None,
    frequency: Optional[str] = None,
    merchant: Optional[str] = None,
    currency: Optional[str] = None,
    category_id: Optional[str] = None,
    importance: Optional[int] = None,
    description: Optional[str] = None,
    is_variable_amount: Optional[bool] = None,
    next_due_date: Optional[str] = None,
    end_date: Optional[str] = None,
    auto_generate: Optional[bool] = None,
    is_active: Optional[bool] = None,
    dry_run: bool = False,
    idempotency_key: Optional[str] = None,
) -> dict:
    """
    Update a recurring transaction. Omitted fields keep their current value.

    The schedule rules are checked against the row's state *after* the
    merge, so switching auto_generate on without a due date already on file
    is rejected even though this call never mentioned the due date.

    Args:
        user_id: The user's ID
        recurring_id: The recurring transaction's ID
        name: New name (optional)
        amount: New typical charge, must be > 0 (optional)
        account_id: Move it to another account (optional)
        frequency: weekly, biweekly, monthly, quarterly, yearly (optional)
        merchant: New merchant, or "" to clear it (optional)
        currency: New ISO code (optional). The amount is re-denominated,
            not converted.
        category_id: New category, or "" to clear it (optional)
        importance: 1-3 (optional)
        description: New note, or "" to clear it (optional)
        is_variable_amount: Whether the charge varies (optional)
        next_due_date: YYYY-MM-DD for the next charge, or "" to clear the
            schedule (optional). Clearing it while auto_generate stays on is
            rejected.
        end_date: YYYY-MM-DD, or "" to remove the end (optional)
        auto_generate: Turn automatic booking on or off (optional)
        is_active: Activate or deactivate (optional)
        dry_run: Apply it, report it, then roll it back (default False)
        idempotency_key: Caller-chosen id making a retry safe (see
            create_recurring_transaction)

    Returns:
        {"changed", "before", "after", "fields_changed",
        "recurring_transaction", "dry_run", "committed"}. `changed` is False
        when every field was already the value asked for.
    """
    recurring_uuid = require_uuid(recurring_id, "recurring_id")

    provided = (
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
    )
    if all(v is None for v in provided):
        raise missing_argument("fields to update", "pass at least one field to change")

    if name is not None and not name.strip():
        raise missing_argument("name", "a recurring transaction needs a non-empty name")
    if amount is not None:
        _validate_amount(amount)
    if frequency is not None:
        _validate_frequency(frequency)
    if importance is not None:
        _validate_importance(importance)

    parsed_next_due = _parse_date(next_due_date, "next_due_date")
    parsed_end = _parse_date(end_date, "end_date")

    arguments = {
        "recurring_id": recurring_id,
        "name": name,
        "amount": amount,
        "account_id": account_id,
        "frequency": frequency,
        "merchant": merchant,
        "currency": currency,
        "category_id": category_id,
        "importance": importance,
        "description": description,
        "is_variable_amount": is_variable_amount,
        "next_due_date": next_due_date,
        "end_date": end_date,
        "auto_generate": auto_generate,
        "is_active": is_active,
    }

    with get_db() as db:
        stored, digest = replay(
            db,
            user_id,
            "update_recurring_transaction",
            None if dry_run else idempotency_key,
            arguments,
        )
        if stored is not None:
            return stored

        recurring = _load(db, user_id, recurring_uuid)
        before = snapshot(recurring, EDITABLE_FIELDS)

        target_auto = auto_generate if auto_generate is not None else bool(recurring.auto_generate)
        target_next_due = parsed_next_due if next_due_date is not None else recurring.next_due_date
        target_end = parsed_end if end_date is not None else recurring.end_date
        _validate_schedule(target_auto, target_next_due, target_end)

        account_uuid = _require_account(db, user_id, account_id) if account_id is not None else None
        if category_id:
            category_uuid = _require_category(db, user_id, category_id)
        else:
            category_uuid = None

        if name is not None or account_uuid is not None:
            target_name = name.strip() if name is not None else recurring.name
            target_account = account_uuid or recurring.account_id
            if target_account is not None and _duplicate_name(
                db, user_id, target_account, target_name, exclude_id=recurring.id
            ):
                raise invalid_format(
                    "name",
                    target_name,
                    "a name not already used on this account",
                    hint="Call list_recurring_transactions() to see what exists.",
                )

        try:
            if name is not None:
                recurring.name = name.strip()
            if amount is not None:
                recurring.amount = Decimal(str(amount))
            if account_uuid is not None:
                recurring.account_id = account_uuid
            if frequency is not None:
                recurring.frequency = frequency
            if merchant is not None:
                recurring.merchant = merchant.strip() or None
            if currency is not None:
                recurring.currency = currency.upper()
            if category_id is not None:
                # "" clears the category, an id sets it.
                recurring.category_id = category_uuid
            if importance is not None:
                recurring.importance = importance
            if description is not None:
                recurring.description = description.strip() or None
            if is_variable_amount is not None:
                recurring.is_variable_amount = is_variable_amount
            if next_due_date is not None:
                recurring.next_due_date = parsed_next_due
            if end_date is not None:
                recurring.end_date = parsed_end
            if auto_generate is not None:
                recurring.auto_generate = auto_generate
            if is_active is not None:
                recurring.is_active = is_active

            def _updated() -> dict:
                reloaded = _load(db, user_id, recurring_uuid)
                return mutation_result(
                    before,
                    snapshot(reloaded, EDITABLE_FIELDS),
                    recurring_transaction=_serialize(reloaded),
                )

            response = preview_or_commit(db, dry_run, _updated)
        except Exception as e:  # noqa: BLE001
            db.rollback()
            raise_database_error("update_recurring_transaction", e)

        if not dry_run:
            remember(db, user_id, "update_recurring_transaction", idempotency_key, digest, response)
        return response


def delete_recurring_transaction(user_id: str, recurring_id: str, dry_run: bool = False) -> dict:
    """
    Permanently delete a recurring transaction definition.

    Transactions survive. Their link is set to null, which means any rows
    this schedule already booked stay in the ledger as ordinary
    transactions, no longer grouped under the subscription and no longer
    reconcilable against a real charge that arrives later. Deactivating
    (`update_recurring_transaction(is_active=False)`) keeps the history
    intact and is usually what "cancel this subscription" means.

    Args:
        user_id: The user's ID
        recurring_id: The recurring transaction's ID
        dry_run: Report what would be destroyed without destroying it
            (default False)

    Returns:
        {"deleted_recurring_transaction": {...}, "dry_run": bool,
        "committed": bool}
    """
    recurring_uuid = require_uuid(recurring_id, "recurring_id")

    with get_db() as db:
        recurring = _load(db, user_id, recurring_uuid)

        # Counted before the delete: "what am I about to lose" is the whole
        # question a dry run on a delete is asked to answer, and the
        # placeholders are the part that is not obvious.
        linked = (
            db.query(Transaction)
            .filter(
                Transaction.user_id == user_id,
                Transaction.recurring_transaction_id == recurring.id,
            )
            .all()
        )
        doomed = {
            **_serialize(recurring),
            "unlinked_transaction_count": len(linked),
            "orphaned_generated_transaction_count": sum(1 for t in linked if t.auto_generated),
        }

        try:
            db.delete(recurring)
            return preview_or_commit(db, dry_run, lambda: {"deleted_recurring_transaction": doomed})
        except Exception as e:  # noqa: BLE001
            db.rollback()
            raise_database_error("delete_recurring_transaction", e)


def generate_recurring_occurrence(
    user_id: str,
    recurring_id: str,
    dry_run: bool = False,
    idempotency_key: Optional[str] = None,
) -> dict:
    """
    Book the next scheduled occurrence now, ahead of its due date.

    Runs the same generator the daily beat runs, so the transaction gets the
    same sign, currency conversion and account balance recalculation. The
    definition advances to the following occurrence.

    A no-op (created_count 0) when a transaction already covers that date:
    the generator treats a real bank row within 7 days and 15% of the
    expected amount as the occurrence having already happened.

    Args:
        user_id: The user's ID
        recurring_id: The recurring transaction's ID
        dry_run: Generate it, report it, then roll it back (default False)
        idempotency_key: Caller-chosen id making a retry safe. Without one, a
            retry after a lost response books a second occurrence and
            advances the schedule twice.

    Returns:
        {"created_count", "transactions", "next_due_date", "dry_run",
        "committed"}. Raises ToolError when the definition has no schedule,
        no account, is inactive, has auto_generate off, or has already
        ended.
    """
    recurring_uuid = require_uuid(recurring_id, "recurring_id")
    arguments = {"recurring_id": recurring_id}

    with _session(dry_run) as db:
        stored, digest = replay(
            db,
            user_id,
            "generate_recurring_occurrence",
            None if dry_run else idempotency_key,
            arguments,
        )
        if stored is not None:
            return stored

        recurring = _load(db, user_id, recurring_uuid)

        # Each of these is a filter in the generator's own query. Checking
        # them here turns "created 0 transactions" -- which reads as "that
        # date is already covered" -- into a statement of what is actually
        # wrong.
        if not recurring.next_due_date:
            raise missing_argument(
                "next_due_date",
                f"{recurring.name!r} has no schedule; set one with "
                f"update_recurring_transaction(next_due_date=...)",
            )
        if not recurring.account_id:
            raise missing_argument(
                "account_id",
                f"{recurring.name!r} has no account to book the transaction on",
            )
        if not recurring.is_active:
            raise invalid_format(
                "recurring_id",
                recurring_id,
                "an active recurring transaction",
                hint=f"{recurring.name!r} is inactive; reactivate it first.",
            )
        if not recurring.auto_generate:
            raise invalid_format(
                "recurring_id",
                recurring_id,
                "a recurring transaction with auto_generate on",
                hint=(
                    f"{recurring.name!r} only labels existing transactions. "
                    f"Turn booking on with "
                    f"update_recurring_transaction(auto_generate=True)."
                ),
            )
        if recurring.end_date and recurring.next_due_date > recurring.end_date:
            raise out_of_range(
                "next_due_date",
                recurring.next_due_date.isoformat(),
                maximum=recurring.end_date.isoformat(),
            )

        try:
            result = generate_due_transactions(
                db,
                user_id=user_id,
                recurring_ids=[recurring.id],
                single_occurrence=True,
            )
            db.refresh(recurring)
            response = {
                "created_count": len(result.created),
                "transactions": [
                    {
                        "id": str(t.id),
                        "amount": float(t.amount),
                        "currency": t.currency,
                        "description": t.description,
                        "booked_at": t.booked_at.isoformat() if t.booked_at else None,
                    }
                    for t in result.created
                ],
                "skipped_existing": result.skipped_existing,
                "next_due_date": (
                    recurring.next_due_date.isoformat() if recurring.next_due_date else None
                ),
                "dry_run": dry_run,
                "committed": not dry_run,
            }
        except Exception as e:  # noqa: BLE001
            db.rollback()
            raise_database_error("generate_recurring_occurrence", e)

    if not dry_run:
        # Outside the session above, which the generator has already
        # committed into; the key is stored in its own transaction.
        with get_db() as key_db:
            remember(
                key_db,
                user_id,
                "generate_recurring_occurrence",
                idempotency_key,
                digest,
                response,
            )
    return response


def skip_recurring_occurrence(
    user_id: str,
    recurring_id: str,
    dry_run: bool = False,
    idempotency_key: Optional[str] = None,
) -> dict:
    """
    Advance the schedule by one period without booking anything.

    For the month a subscription is paused, a bill is waived, or the charge
    was already captured by a transaction nobody linked. Unlike the web
    app's Skip button this does not require an account on the definition,
    because skipping writes no transaction.

    Args:
        user_id: The user's ID
        recurring_id: The recurring transaction's ID
        dry_run: Advance it, report it, then roll it back (default False)
        idempotency_key: Caller-chosen id making a retry safe. Without one, a
            retry after a lost response skips two periods.

    Returns:
        {"skipped_date", "next_due_date", "auto_generate", "dry_run",
        "committed"}. Raises ToolError when the definition has no schedule.
    """
    recurring_uuid = require_uuid(recurring_id, "recurring_id")
    arguments = {"recurring_id": recurring_id}

    with get_db() as db:
        stored, digest = replay(
            db,
            user_id,
            "skip_recurring_occurrence",
            None if dry_run else idempotency_key,
            arguments,
        )
        if stored is not None:
            return stored

        recurring = _load(db, user_id, recurring_uuid)
        if not recurring.next_due_date:
            raise missing_argument(
                "next_due_date",
                f"{recurring.name!r} has no schedule, so there is no occurrence to skip",
            )

        skipped = recurring.next_due_date
        try:
            recurring.next_due_date = compute_next_due_date(recurring.frequency, skipped)
            # Past its end the schedule stops rather than rolling forever;
            # the same rule the generator applies.
            if recurring.end_date and recurring.next_due_date > recurring.end_date:
                recurring.auto_generate = False

            def _skipped() -> dict:
                return {
                    "skipped_date": skipped.isoformat(),
                    "next_due_date": recurring.next_due_date.isoformat(),
                    "auto_generate": bool(recurring.auto_generate),
                }

            response = preview_or_commit(db, dry_run, _skipped)
        except ValueError as e:
            db.rollback()
            raise invalid_enum("frequency", recurring.frequency, VALID_FREQUENCIES) from e
        except Exception as e:  # noqa: BLE001
            db.rollback()
            raise_database_error("skip_recurring_occurrence", e)

        if not dry_run:
            remember(db, user_id, "skip_recurring_occurrence", idempotency_key, digest, response)
        return response
