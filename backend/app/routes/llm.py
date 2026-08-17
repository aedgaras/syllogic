import json
import logging
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.database import get_db
from app.services.app_settings import get_llm_model
from app.services.llm_client import create_llm_client


router = APIRouter()
logger = logging.getLogger(__name__)


class ColumnMappingRequest(BaseModel):
    headers: list[str] = Field(..., min_length=1, max_length=200)
    sample_rows: list[list[str]] = Field(default_factory=list, max_length=3)
    date_formats: list[str] = Field(..., min_length=1, max_length=50)

    @field_validator("headers")
    @classmethod
    def validate_headers(cls, headers: list[str]) -> list[str]:
        if any(len(header) > 500 for header in headers):
            raise ValueError("CSV headers must be at most 500 characters each.")
        return headers

    @field_validator("sample_rows")
    @classmethod
    def validate_sample_rows(cls, rows: list[list[str]]) -> list[list[str]]:
        if any(len(cell) > 2_000 for row in rows for cell in row):
            raise ValueError("CSV samples must be at most 2,000 characters per cell.")
        return rows


class ColumnMappingResponse(BaseModel):
    mapping: dict


@router.post("/column-mapping", response_model=ColumnMappingResponse)
def map_csv_columns(payload: ColumnMappingRequest, db: Session = Depends(get_db)):
    client = create_llm_client(db)
    if client is None:
        raise HTTPException(status_code=503, detail="LLM API is not configured.")

    sample_data = []
    for row in payload.sample_rows[:3]:
        sample_data.append(
            {
                header: (row[index] if index < len(row) else "")
                for index, header in enumerate(payload.headers)
            }
        )

    date_format_options = ", ".join(json.dumps(value) for value in payload.date_formats)
    prompt = f"""You are a CSV column mapping assistant. Analyze these CSV headers and sample data to map them to transaction fields.

Headers: {json.dumps(payload.headers)}

Sample data (first 3 rows):
{json.dumps(sample_data, indent=2)}

Map these columns to the following transaction fields:
- date: The transaction date column (prefer "Completed Date" over "Started Date" if both exist)
- amount: The transaction amount column
- description: The transaction description/narrative column
- merchant: The merchant/payee name column (if separate from description)
- transactionType: The column indicating debit/credit (if exists)
- fee: Column containing transaction fees (if exists)
- state: Column containing transaction state/status (if exists)
- startingBalance: Column containing opening/starting balance (if exists)
- endingBalance: Column containing closing/ending balance (if exists)

Also determine whether amount is signed, its decimal format, credit/debit values,
the exact date format, and the completed state value. Supported date formats:
{date_format_options}

Respond ONLY with a valid JSON object in this exact shape:
{{
  "date": "column_name_or_null",
  "amount": "column_name_or_null",
  "description": "column_name_or_null",
  "merchant": "column_name_or_null",
  "transactionType": "column_name_or_null",
  "fee": "column_name_or_null",
  "state": "column_name_or_null",
  "startingBalance": "column_name_or_null",
  "endingBalance": "column_name_or_null",
  "typeConfig": {{
    "creditValue": "value_that_indicates_credit_or_null",
    "debitValue": "value_that_indicates_debit_or_null",
    "isAmountSigned": true,
    "amountFormat": "AUTO",
    "dateFormat": "one_supported_date_format",
    "completedStateValue": "value_that_indicates_completed_or_null"
  }}
}}

Use null for columns that do not exist or cannot be determined. amountFormat must
be AUTO, DOT_DECIMAL, or COMMA_DECIMAL. Default dateFormat to DD-MM-YYYY when uncertain."""

    try:
        response = client.chat.completions.create(
            model=get_llm_model(),
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
        )
        content = response.choices[0].message.content or ""
        match = re.search(r"\{[\s\S]*\}", content)
        if not match:
            raise ValueError("LLM response did not contain a JSON object")
        mapping = json.loads(match.group(0))
        if not isinstance(mapping, dict):
            raise ValueError("LLM response was not a JSON object")
        return {"mapping": mapping}
    except Exception as exc:
        logger.exception("LLM column mapping failed")
        raise HTTPException(status_code=502, detail="LLM column mapping failed.") from exc
