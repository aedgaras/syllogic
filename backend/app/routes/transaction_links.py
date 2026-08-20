import uuid
from datetime import datetime
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, desc, func, or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.db_helpers import get_user_id
from app.models import Account, Transaction, TransactionLink
from app.schemas import (
    AccountOptionResponse,
    AddToLinkGroupRequest,
    CreateLinkGroupFromSelectionRequest,
    CreateLinkGroupRequest,
    CreateLinkGroupResponse,
    LinkedTransactionResponse,
    LinkSearchResponse,
    RemoveFromLinkGroupResponse,
    SuggestedLinkResponse,
    TransactionLinkGroupResponse,
    TransactionLinkInfoResponse,
)

router = APIRouter()


def _build_link_group(
    db: Session, group_id: uuid.UUID, links: List[TransactionLink]
) -> TransactionLinkGroupResponse:
    txn_ids = [link.transaction_id for link in links]
    role_by_txn_id = {link.transaction_id: link.link_role for link in links}
    txns = db.query(Transaction).filter(Transaction.id.in_(txn_ids)).all()

    primary: Optional[LinkedTransactionResponse] = None
    linked: List[LinkedTransactionResponse] = []
    net_amount = 0
    currency: Optional[str] = None

    for txn in txns:
        role = role_by_txn_id.get(txn.id, "reimbursement")
        currency = txn.currency
        net_amount += txn.amount
        item = LinkedTransactionResponse(
            id=txn.id,
            amount=txn.amount,
            description=txn.description,
            merchant=txn.merchant,
            booked_at=txn.booked_at,
            transaction_type=txn.transaction_type,
            link_role=role,
        )
        if role == "primary":
            primary = item
        else:
            linked.append(item)

    linked.sort(key=lambda item: item.booked_at)

    return TransactionLinkGroupResponse(
        group_id=group_id, primary=primary, linked=linked, net_amount=net_amount, currency=currency
    )


@router.get("/accounts-for-linking", response_model=List[AccountOptionResponse])
def get_accounts_for_linking(user_id: str = Depends(get_user_id), db: Session = Depends(get_db)):
    """Accounts for the link-search filter dropdown."""
    accounts = (
        db.query(Account.id, Account.name)
        .filter(Account.user_id == user_id)
        .order_by(Account.name)
        .all()
    )
    return [AccountOptionResponse(id=acc.id, name=acc.name) for acc in accounts]


@router.post("/groups", response_model=CreateLinkGroupResponse, status_code=201)
def create_link_group(
    payload: CreateLinkGroupRequest,
    user_id: str = Depends(get_user_id),
    db: Session = Depends(get_db),
):
    """Creates a new link group with a primary transaction and one or more
    linked (reimbursement/expense) transactions. Group id is generated
    server-side, never trusted from the client."""
    if not payload.linked_ids:
        raise HTTPException(status_code=400, detail="At least one linked transaction is required")

    all_ids = [payload.primary_id, *payload.linked_ids]
    owned_count = (
        db.query(func.count(Transaction.id))
        .filter(Transaction.id.in_(all_ids), Transaction.user_id == user_id)
        .scalar()
    )
    if owned_count != len(set(all_ids)):
        raise HTTPException(
            status_code=404, detail="Some transactions not found or not owned by user"
        )

    already_linked = (
        db.query(func.count(TransactionLink.id))
        .filter(TransactionLink.transaction_id.in_(all_ids))
        .scalar()
    )
    if already_linked:
        raise HTTPException(
            status_code=409, detail="One or more transactions are already linked to a group"
        )

    group_id = uuid.uuid4()
    db.add(
        TransactionLink(
            user_id=user_id,
            group_id=group_id,
            transaction_id=payload.primary_id,
            link_role="primary",
        )
    )
    for txn_id in payload.linked_ids:
        db.add(
            TransactionLink(
                user_id=user_id,
                group_id=group_id,
                transaction_id=txn_id,
                link_role=payload.link_type,
            )
        )
    db.commit()
    return CreateLinkGroupResponse(group_id=group_id)


@router.post("/groups/{group_id}/transactions", status_code=204)
def add_to_link_group(
    group_id: UUID,
    payload: AddToLinkGroupRequest,
    user_id: str = Depends(get_user_id),
    db: Session = Depends(get_db),
):
    """Adds a transaction to an existing link group."""
    transaction = (
        db.query(Transaction)
        .filter(Transaction.id == payload.transaction_id, Transaction.user_id == user_id)
        .first()
    )
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")

    group_exists = (
        db.query(TransactionLink)
        .filter(TransactionLink.group_id == group_id, TransactionLink.user_id == user_id)
        .first()
    )
    if not group_exists:
        raise HTTPException(status_code=404, detail="Link group not found")

    existing_link = (
        db.query(TransactionLink)
        .filter(TransactionLink.transaction_id == payload.transaction_id)
        .first()
    )
    if existing_link:
        raise HTTPException(status_code=409, detail="Transaction is already linked to a group")

    db.add(
        TransactionLink(
            user_id=user_id,
            group_id=group_id,
            transaction_id=payload.transaction_id,
            link_role=payload.role,
        )
    )
    db.commit()
    return None


@router.delete("/transactions/{transaction_id}", response_model=RemoveFromLinkGroupResponse)
def remove_transaction_from_link_group(
    transaction_id: UUID, user_id: str = Depends(get_user_id), db: Session = Depends(get_db)
):
    """Removes a transaction from its link group. If it's the primary
    transaction, or only one other transaction would remain, deletes the
    entire group instead of leaving an orphaned/single-sided group."""
    link = (
        db.query(TransactionLink)
        .filter(
            TransactionLink.transaction_id == transaction_id, TransactionLink.user_id == user_id
        )
        .first()
    )
    if not link:
        raise HTTPException(status_code=404, detail="Transaction is not linked to any group")

    group_id = link.group_id
    group_size = (
        db.query(func.count(TransactionLink.id))
        .filter(TransactionLink.group_id == group_id)
        .scalar()
    )

    if link.link_role == "primary" or group_size <= 2:
        db.query(TransactionLink).filter(TransactionLink.group_id == group_id).delete(
            synchronize_session=False
        )
        db.commit()
        return RemoveFromLinkGroupResponse(group_deleted=True)

    db.query(TransactionLink).filter(TransactionLink.transaction_id == transaction_id).delete(
        synchronize_session=False
    )
    db.commit()
    return RemoveFromLinkGroupResponse(group_deleted=False)


@router.delete("/groups/{group_id}", status_code=204)
def delete_link_group(
    group_id: UUID, user_id: str = Depends(get_user_id), db: Session = Depends(get_db)
):
    """Deletes an entire link group."""
    exists = (
        db.query(TransactionLink)
        .filter(TransactionLink.group_id == group_id, TransactionLink.user_id == user_id)
        .first()
    )
    if not exists:
        raise HTTPException(status_code=404, detail="Link group not found")

    db.query(TransactionLink).filter(TransactionLink.group_id == group_id).delete(
        synchronize_session=False
    )
    db.commit()
    return None


@router.get(
    "/transactions/{transaction_id}/group", response_model=Optional[TransactionLinkGroupResponse]
)
def get_transaction_link_group(
    transaction_id: UUID, user_id: str = Depends(get_user_id), db: Session = Depends(get_db)
):
    """The link group for a transaction, including all linked transactions
    and net amount. None if the transaction isn't linked."""
    link = (
        db.query(TransactionLink)
        .filter(
            TransactionLink.transaction_id == transaction_id, TransactionLink.user_id == user_id
        )
        .first()
    )
    if not link:
        return None

    group_links = db.query(TransactionLink).filter(TransactionLink.group_id == link.group_id).all()
    return _build_link_group(db, link.group_id, group_links)


@router.get("/groups", response_model=List[TransactionLinkGroupResponse])
def get_user_link_groups(user_id: str = Depends(get_user_id), db: Session = Depends(get_db)):
    """All link groups for the current user."""
    user_links = db.query(TransactionLink).filter(TransactionLink.user_id == user_id).all()

    links_by_group: dict[uuid.UUID, List[TransactionLink]] = {}
    for link in user_links:
        links_by_group.setdefault(link.group_id, []).append(link)

    return [_build_link_group(db, group_id, links) for group_id, links in links_by_group.items()]


def _find_suggested_links(
    db: Session,
    user_id: str,
    transaction_id: UUID,
    direction: str,
    search: Optional[str],
    account_id: Optional[UUID],
    date_from,
    date_to,
    min_amount: Optional[float],
    max_amount: Optional[float],
    page: int,
    page_size: int,
) -> LinkSearchResponse:
    source_txn = (
        db.query(Transaction)
        .filter(Transaction.id == transaction_id, Transaction.user_id == user_id)
        .first()
    )
    if not source_txn:
        return LinkSearchResponse(transactions=[], total_count=0, has_more=False)

    source_amount = float(source_txn.amount)
    if direction == "reimbursement":
        # Only look for reimbursements against an expense (debit/negative amount).
        if source_amount >= 0:
            return LinkSearchResponse(transactions=[], total_count=0, has_more=False)
        target_type = "credit"
    else:
        # Only look for expenses against income/an allowance (credit/positive amount).
        if source_amount <= 0:
            return LinkSearchResponse(transactions=[], total_count=0, has_more=False)
        target_type = "debit"

    linked_ids = [
        row.transaction_id
        for row in db.query(TransactionLink.transaction_id).filter(
            TransactionLink.user_id == user_id
        )
    ]

    conditions = [
        Transaction.user_id == user_id,
        Transaction.transaction_type == target_type,
        Transaction.currency == (source_txn.currency or "EUR"),
        Transaction.id != transaction_id,
    ]
    if linked_ids:
        conditions.append(Transaction.id.notin_(linked_ids))
    if search:
        term = f"%{search}%"
        conditions.append(
            or_(Transaction.merchant.ilike(term), Transaction.description.ilike(term))
        )
    if account_id:
        conditions.append(Transaction.account_id == account_id)
    if date_from:
        conditions.append(Transaction.booked_at >= date_from)
    if date_to:
        conditions.append(Transaction.booked_at <= date_to)
    if direction == "reimbursement":
        # Credits are stored positive: compare directly against the requested range.
        if min_amount is not None:
            conditions.append(Transaction.amount >= min_amount)
        if max_amount is not None:
            conditions.append(Transaction.amount <= max_amount)
    else:
        # Debits are stored negative: the requested range is in absolute terms.
        if min_amount is not None:
            conditions.append(Transaction.amount <= -min_amount)
        if max_amount is not None:
            conditions.append(Transaction.amount >= -max_amount)

    total_count = db.query(func.count(Transaction.id)).filter(and_(*conditions)).scalar() or 0

    offset = (page - 1) * page_size
    rows = (
        db.query(Transaction)
        .filter(and_(*conditions))
        .order_by(desc(Transaction.booked_at))
        .offset(offset)
        .limit(page_size)
        .all()
    )
    suggestions = [
        SuggestedLinkResponse(
            id=txn.id,
            amount=txn.amount,
            description=txn.description,
            merchant=txn.merchant,
            booked_at=txn.booked_at,
            transaction_type=txn.transaction_type,
            account_id=txn.account_id,
            account_name=txn.account.name if txn.account else None,
            score=0,
        )
        for txn in rows
    ]
    return LinkSearchResponse(
        transactions=suggestions,
        total_count=total_count,
        has_more=offset + len(suggestions) < total_count,
    )


@router.get("/transactions/{transaction_id}/reimbursements", response_model=LinkSearchResponse)
def find_potential_reimbursements(
    transaction_id: UUID,
    search: Optional[str] = None,
    account_id: Optional[UUID] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    min_amount: Optional[float] = None,
    max_amount: Optional[float] = None,
    page: int = 1,
    page_size: int = Query(50, alias="page_size"),
    user_id: str = Depends(get_user_id),
    db: Session = Depends(get_db),
):
    """Potential reimbursement transactions (credits, across all accounts)
    for an expense — server-side filtered and paginated."""
    return _find_suggested_links(
        db,
        user_id,
        transaction_id,
        "reimbursement",
        search,
        account_id,
        date_from,
        date_to,
        min_amount,
        max_amount,
        page,
        page_size,
    )


@router.get("/transactions/{transaction_id}/expenses", response_model=LinkSearchResponse)
def find_potential_expenses(
    transaction_id: UUID,
    search: Optional[str] = None,
    account_id: Optional[UUID] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    min_amount: Optional[float] = None,
    max_amount: Optional[float] = None,
    page: int = 1,
    page_size: int = Query(50, alias="page_size"),
    user_id: str = Depends(get_user_id),
    db: Session = Depends(get_db),
):
    """Potential expense transactions (debits, across all accounts) for an
    income/allowance — server-side filtered and paginated."""
    return _find_suggested_links(
        db,
        user_id,
        transaction_id,
        "expense",
        search,
        account_id,
        date_from,
        date_to,
        min_amount,
        max_amount,
        page,
        page_size,
    )


@router.get(
    "/transactions/{transaction_id}/link-info", response_model=Optional[TransactionLinkInfoResponse]
)
def get_transaction_link_info(
    transaction_id: UUID, user_id: str = Depends(get_user_id), db: Session = Depends(get_db)
):
    """The link-group membership row for a single transaction, if any."""
    link = (
        db.query(TransactionLink)
        .filter(
            TransactionLink.transaction_id == transaction_id, TransactionLink.user_id == user_id
        )
        .first()
    )
    if not link:
        return None
    return TransactionLinkInfoResponse(
        id=link.id,
        group_id=link.group_id,
        transaction_id=link.transaction_id,
        link_role=link.link_role,
        created_at=link.created_at,
    )


@router.post("/groups/from-selection", response_model=CreateLinkGroupResponse, status_code=201)
def create_link_group_from_selection(
    payload: CreateLinkGroupFromSelectionRequest,
    user_id: str = Depends(get_user_id),
    db: Session = Depends(get_db),
):
    """Bulk-creates a link group from selected transactions. Auto-detects
    the primary (largest absolute amount) and infers reimbursement/expense
    from its sign, mirroring the single-primary create_link_group flow."""
    if len(payload.transaction_ids) < 2:
        raise HTTPException(status_code=400, detail="At least 2 transactions are required")

    txns = (
        db.query(Transaction)
        .filter(Transaction.id.in_(payload.transaction_ids), Transaction.user_id == user_id)
        .all()
    )
    if len(txns) != len(set(payload.transaction_ids)):
        raise HTTPException(
            status_code=404, detail="Some transactions not found or not owned by user"
        )

    already_linked = (
        db.query(func.count(TransactionLink.id))
        .filter(TransactionLink.transaction_id.in_(payload.transaction_ids))
        .scalar()
    )
    if already_linked:
        raise HTTPException(status_code=409, detail="One or more transactions are already linked")

    primary_txn = max(txns, key=lambda txn: abs(txn.amount))
    link_type = "reimbursement" if primary_txn.amount < 0 else "expense"

    group_id = uuid.uuid4()
    for txn in txns:
        role = "primary" if txn.id == primary_txn.id else link_type
        db.add(
            TransactionLink(
                user_id=user_id, group_id=group_id, transaction_id=txn.id, link_role=role
            )
        )
    db.commit()
    return CreateLinkGroupResponse(group_id=group_id)
