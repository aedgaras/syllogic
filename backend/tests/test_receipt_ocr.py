"""Unit tests for the receipt OCR/parsing service."""

from decimal import Decimal

from app.services.receipt_ocr import _parse_llm_items, parse_line_items


GROCERY_RECEIPT = """
GROCERY MART
Milk 2L                3.49
Bread Whole Wheat      2.99
Eggs 12ct               4.50
Bananas 1kg              1.20
Subtotal               12.18
Tax                     0.98
Total                  13.16
CASH                   20.00
Change                  6.84
"""

RESTAURANT_RECEIPT = """
Trattoria Roma
Table 4
Margherita Pizza        12,50
House Wine (glass)       6,00
Tiramisu                 5,50
SUBTOTAL                24,00
VAT 10%                  2,40
TOTAL                   26,40
"""


def test_parse_line_items_extracts_grocery_items_and_skips_totals():
    parsed = parse_line_items(GROCERY_RECEIPT)

    descriptions = [item.description for item in parsed.items]
    assert descriptions == ["Milk 2L", "Bread Whole Wheat", "Eggs 12ct", "Bananas 1kg"]
    assert parsed.items[0].amount == Decimal("3.49")
    assert parsed.receipt_total == Decimal("13.16")
    assert parsed.confidence == "high"


def test_parse_line_items_handles_comma_decimal_separator():
    parsed = parse_line_items(RESTAURANT_RECEIPT)

    descriptions = [item.description for item in parsed.items]
    assert descriptions == ["Margherita Pizza", "House Wine (glass)", "Tiramisu"]
    assert parsed.items[0].amount == Decimal("12.50")
    assert parsed.receipt_total == Decimal("26.40")


def test_parse_line_items_low_confidence_when_no_items_found():
    parsed = parse_line_items("this receipt has no price-shaped lines at all")

    assert parsed.items == []
    assert parsed.confidence == "low"


def test_parse_line_items_low_confidence_when_total_deviates_from_item_sum():
    noisy_receipt = """
    Widget                 5.00
    Total                  50.00
    """
    parsed = parse_line_items(noisy_receipt)

    assert len(parsed.items) == 1
    assert parsed.confidence == "low"


def test_parse_llm_items_parses_plain_json_array():
    items = _parse_llm_items('[{"description": "Coffee", "amount": 3.5}]')

    assert items is not None
    assert items[0].description == "Coffee"
    assert items[0].amount == Decimal("3.5")


def test_parse_llm_items_strips_code_fences():
    content = '```json\n[{"description": "Tea", "amount": 2.0}]\n```'

    items = _parse_llm_items(content)

    assert items is not None
    assert items[0].description == "Tea"


def test_parse_llm_items_returns_none_for_non_json():
    assert _parse_llm_items("sorry, I can't help with that") is None


def test_parse_llm_items_skips_malformed_entries():
    content = '[{"description": "Good", "amount": 1}, {"description": "Bad"}, "not-a-dict"]'

    items = _parse_llm_items(content)

    assert items is not None
    assert len(items) == 1
    assert items[0].description == "Good"
