"""
Service for turning a scanned receipt image into categorized transaction
line items: tesseract OCR -> regex line-item parsing (LLM-refined when the
regex pass looks unreliable) -> category matching per item.
"""

import io
import json
import logging
import re
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import List, Optional

import pytesseract
from PIL import Image
from sqlalchemy.orm import Session

from app.services.category_matcher import CategoryMatcher
from app.services.llm_client import create_llm_clients, is_fallback_worthy_error

logger = logging.getLogger(__name__)

# Lines containing these words are treated as receipt-total candidates, not
# purchasable line items (a "Total" line still ends in a price and would
# otherwise match the item regex).
_NON_ITEM_KEYWORDS = (
    "total",
    "subtotal",
    "sub total",
    "tax",
    "vat",
    "change",
    "cash",
    "card",
    "balance",
    "tender",
    "amount due",
)

# "<description> <price>" with an optional currency symbol on the price.
_ITEM_LINE_RE = re.compile(r"^(?P<description>.+?)\s+[\$€£]?(?P<amount>\d+[.,]\d{2})$")


@dataclass
class ReceiptLineItem:
    description: str
    amount: Decimal
    category_id: Optional[str] = None
    category_name: Optional[str] = None


@dataclass
class ParsedReceipt:
    items: List[ReceiptLineItem] = field(default_factory=list)
    receipt_total: Optional[Decimal] = None
    confidence: str = "low"  # "low" or "high"


def extract_text(image_bytes: bytes) -> str:
    """Run tesseract OCR on a receipt image and return the raw text."""
    image = Image.open(io.BytesIO(image_bytes))
    if image.mode != "L":
        image = image.convert("L")
    return pytesseract.image_to_string(image)


def _to_decimal(raw: str) -> Optional[Decimal]:
    try:
        return Decimal(raw.replace(",", "."))
    except InvalidOperation:
        return None


def parse_line_items(raw_text: str) -> ParsedReceipt:
    """
    Regex pass over OCR'd text: lines that look like "<description> <price>"
    become line items; lines mentioning total/tax/etc are captured as the
    receipt total candidate instead of being treated as purchases.
    """
    items: List[ReceiptLineItem] = []
    receipt_total: Optional[Decimal] = None

    for raw_line in raw_text.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        match = _ITEM_LINE_RE.match(line)
        if not match:
            continue

        amount = _to_decimal(match.group("amount"))
        if amount is None:
            continue

        description = match.group("description").strip(" -:\t")
        if not description:
            continue

        if any(keyword in description.lower() for keyword in _NON_ITEM_KEYWORDS):
            if "total" in description.lower() and "sub" not in description.lower():
                receipt_total = amount
            continue

        items.append(ReceiptLineItem(description=description, amount=amount))

    confidence = "high"
    if not items:
        confidence = "low"
    elif receipt_total is not None:
        items_sum = sum((item.amount for item in items), Decimal("0"))
        if receipt_total > 0:
            deviation = abs(items_sum - receipt_total) / receipt_total
            if deviation > Decimal("0.15"):
                confidence = "low"

    return ParsedReceipt(items=items, receipt_total=receipt_total, confidence=confidence)


_LLM_SYSTEM_PROMPT = (
    "You extract purchased line items from noisy OCR text of a retail/restaurant "
    "receipt. Respond with ONLY a JSON array (no prose, no code fences) of objects "
    'shaped like {"description": string, "amount": number}. Exclude subtotal, tax, '
    "total, change, and payment-method lines. If you cannot find any items, return []."
)


def refine_with_llm(raw_text: str, db: Session) -> Optional[List[ReceiptLineItem]]:
    """
    Best-effort LLM structuring pass, used only when the regex parse looks
    unreliable. Returns None (caller keeps the regex result) if no provider
    is configured or the response can't be parsed as the expected JSON shape.
    """
    providers = create_llm_clients(db)
    if not providers:
        return None

    messages = [
        {"role": "system", "content": _LLM_SYSTEM_PROMPT},
        {"role": "user", "content": raw_text[:4000]},
    ]

    last_error: Optional[Exception] = None
    for client, model, label in providers:
        try:
            response = client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=0,
                max_tokens=800,
                timeout=30,
            )
            content = response.choices[0].message.content or ""
            return _parse_llm_items(content)
        except Exception as e:
            last_error = e
            logger.warning("Receipt LLM refine via '%s' provider failed: %s", label, e)
            if not is_fallback_worthy_error(e):
                break

    if last_error:
        logger.warning("Receipt LLM refine exhausted all providers: %s", last_error)
    return None


def _parse_llm_items(content: str) -> Optional[List[ReceiptLineItem]]:
    text = content.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:]
    try:
        parsed = json.loads(text)
    except (ValueError, TypeError):
        logger.warning("Receipt LLM refine returned non-JSON content")
        return None

    if not isinstance(parsed, list):
        return None

    items: List[ReceiptLineItem] = []
    for entry in parsed:
        if not isinstance(entry, dict):
            continue
        description = str(entry.get("description") or "").strip()
        amount_raw = entry.get("amount")
        if not description or amount_raw is None:
            continue
        try:
            amount = Decimal(str(amount_raw))
        except InvalidOperation:
            continue
        items.append(ReceiptLineItem(description=description, amount=amount))

    return items


def categorize_items(items: List[ReceiptLineItem], db: Session, user_id: str) -> None:
    """Attach a best-guess category to each item in place. Never raises."""
    matcher = CategoryMatcher(db, user_id)
    for item in items:
        try:
            category = matcher.match_category(
                description=item.description,
                merchant=None,
                amount=item.amount,
                transaction_type="debit",
            )
        except Exception as e:
            logger.warning("Category matching failed for receipt item %r: %s", item.description, e)
            continue
        if category:
            item.category_id = str(category.id)
            item.category_name = category.name
