"""
API endpoints for receipt scanning: upload -> OCR + parse + categorize
(synchronous) -> user-reviewed confirm that splits the receipt into one or
more Transaction rows.
"""

import base64
import binascii
import logging
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.db_helpers import get_user_id
from app.models import Account, Category, ReceiptScan, Transaction
from app.schemas import (
    ReceiptConfirmItem,
    ReceiptLineItemSchema,
    ReceiptScanConfirmRequest,
    ReceiptScanExtractRequest,
    ReceiptScanExtractResponse,
    TransactionWithDetails,
)
from app.services.receipt_ocr import (
    categorize_items,
    extract_text,
    parse_line_items,
    refine_with_llm,
)

logger = logging.getLogger(__name__)

router = APIRouter()

# Base64-decoded receipt photos shouldn't need to exceed this; guards against
# an oversized upload tying up a synchronous OCR request.
MAX_IMAGE_BYTES = 10 * 1024 * 1024


@router.post("/extract", response_model=ReceiptScanExtractResponse)
def extract_receipt(
    request: ReceiptScanExtractRequest,
    user_id: str | None = None,
    db: Session = Depends(get_db),
):
    """OCR an uploaded receipt image and return parsed, categorized line items."""
    resolved_user_id = get_user_id(user_id)

    account = (
        db.query(Account)
        .filter(Account.id == request.account_id, Account.user_id == resolved_user_id)
        .first()
    )
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    try:
        image_bytes = base64.b64decode(request.file_base64, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=400, detail="file_base64 is not valid base64")

    if not image_bytes:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Receipt image is too large")

    receipt_scan = ReceiptScan(
        user_id=resolved_user_id,
        account_id=request.account_id,
        status="pending",
    )
    db.add(receipt_scan)
    db.commit()
    db.refresh(receipt_scan)

    try:
        raw_text = extract_text(image_bytes)
        parsed = parse_line_items(raw_text)

        if parsed.confidence == "low":
            refined = refine_with_llm(raw_text, db)
            if refined:
                parsed.items = refined

        categorize_items(parsed.items, db, resolved_user_id)

        receipt_scan.raw_ocr_text = raw_text
        receipt_scan.receipt_total = parsed.receipt_total
        receipt_scan.status = "processed"
        db.commit()
    except Exception as e:
        logger.exception("Receipt scan %s failed to process", receipt_scan.id)
        receipt_scan.status = "failed"
        receipt_scan.error_message = str(e)[:2000]
        db.commit()
        raise HTTPException(status_code=500, detail="Failed to process receipt") from e

    return ReceiptScanExtractResponse(
        receipt_scan_id=receipt_scan.id,
        status=receipt_scan.status,
        merchant_name=receipt_scan.merchant_name,
        receipt_date=receipt_scan.receipt_date,
        receipt_total=receipt_scan.receipt_total,
        items=[
            ReceiptLineItemSchema(
                description=item.description,
                amount=item.amount,
                category_id=item.category_id,
                category_name=item.category_name,
            )
            for item in parsed.items
        ],
    )


@router.get("/{receipt_scan_id}", response_model=ReceiptScanExtractResponse)
def get_receipt_scan(
    receipt_scan_id: UUID,
    user_id: str | None = None,
    db: Session = Depends(get_db),
):
    resolved_user_id = get_user_id(user_id)
    receipt_scan = (
        db.query(ReceiptScan)
        .filter(ReceiptScan.id == receipt_scan_id, ReceiptScan.user_id == resolved_user_id)
        .first()
    )
    if not receipt_scan:
        raise HTTPException(status_code=404, detail="Receipt scan not found")

    return ReceiptScanExtractResponse(
        receipt_scan_id=receipt_scan.id,
        status=receipt_scan.status or "pending",
        merchant_name=receipt_scan.merchant_name,
        receipt_date=receipt_scan.receipt_date,
        receipt_total=receipt_scan.receipt_total,
        items=[],
    )


@router.post("/{receipt_scan_id}/confirm", response_model=list[TransactionWithDetails])
def confirm_receipt_scan(
    receipt_scan_id: UUID,
    request: ReceiptScanConfirmRequest,
    user_id: str | None = None,
    db: Session = Depends(get_db),
):
    """Create one Transaction per user-reviewed line item."""
    resolved_user_id = get_user_id(user_id)

    receipt_scan = (
        db.query(ReceiptScan)
        .filter(ReceiptScan.id == receipt_scan_id, ReceiptScan.user_id == resolved_user_id)
        .first()
    )
    if not receipt_scan:
        raise HTTPException(status_code=404, detail="Receipt scan not found")

    if not request.items:
        raise HTTPException(status_code=400, detail="No items to import")

    account = (
        db.query(Account)
        .filter(Account.id == receipt_scan.account_id, Account.user_id == resolved_user_id)
        .first()
    )
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    category_ids = {item.category_id for item in request.items if item.category_id}
    category_names: dict = {}
    if category_ids:
        found = (
            db.query(Category.id, Category.name)
            .filter(Category.id.in_(category_ids), Category.user_id == resolved_user_id)
            .all()
        )
        category_names = {row[0]: row[1] for row in found}
        if set(category_names.keys()) != category_ids:
            raise HTTPException(status_code=404, detail="Category not found")

    created: list[Transaction] = []
    for item in request.items:
        transaction = Transaction(
            user_id=resolved_user_id,
            account_id=account.id,
            transaction_type=item.transaction_type,
            amount=item.amount,
            currency=account.currency,
            description=item.description,
            booked_at=request.booked_at,
            category_id=item.category_id,
            receipt_scan_id=receipt_scan.id,
        )
        db.add(transaction)
        created.append(transaction)

    receipt_scan.status = "completed"
    receipt_scan.completed_at = datetime.utcnow()
    db.commit()

    for transaction in created:
        db.refresh(transaction)

    return [
        TransactionWithDetails(
            id=transaction.id,
            account_id=transaction.account_id,
            external_id=transaction.external_id,
            transaction_type=transaction.transaction_type,
            amount=transaction.amount,
            currency=transaction.currency,
            description=transaction.description,
            merchant=transaction.merchant,
            category_id=transaction.category_id,
            category_system_id=transaction.category_system_id,
            booked_at=transaction.booked_at,
            pending=transaction.pending,
            categorization_instructions=transaction.categorization_instructions,
            enrichment_data=transaction.enrichment_data,
            created_at=transaction.created_at,
            updated_at=transaction.updated_at,
            category_name=category_names.get(transaction.category_id),
            account_name=account.name,
        )
        for transaction in created
    ]
