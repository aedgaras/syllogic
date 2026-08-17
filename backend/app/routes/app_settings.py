from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.database import get_db
from app.db_helpers import get_user_id
from app.services.app_settings import (
    AppSettingDecryptError,
    AppSettingEncryptionMissing,
    clear_openai_api_key,
    get_openai_api_key_status,
    set_openai_api_key,
)


router = APIRouter()


class LlmSettingsResponse(BaseModel):
    configured: bool
    source: str
    database_configured: bool
    environment_configured: bool
    base_url: str | None = None
    model: str
    provider: str


class UpdateLlmSettingsRequest(BaseModel):
    api_key: str = Field(..., min_length=1, max_length=500)

    @field_validator("api_key")
    @classmethod
    def normalize_api_key(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("LLM API key is required.")
        return normalized


def _settings_error_response(exc: Exception) -> HTTPException:
    if isinstance(exc, AppSettingEncryptionMissing):
        return HTTPException(
            status_code=500,
            detail="DATA_ENCRYPTION_KEY_CURRENT is required to store LLM API keys in settings.",
        )
    return HTTPException(
        status_code=500,
        detail="Stored LLM API key could not be decrypted.",
    )


@router.get("/llm", response_model=LlmSettingsResponse)
@router.get("/openai", response_model=LlmSettingsResponse, include_in_schema=False)
def get_llm_settings(db: Session = Depends(get_db)):
    try:
        return get_openai_api_key_status(db)
    except (AppSettingDecryptError, AppSettingEncryptionMissing) as exc:
        raise _settings_error_response(exc) from exc


@router.put("/llm", response_model=LlmSettingsResponse)
@router.put("/openai", response_model=LlmSettingsResponse, include_in_schema=False)
def update_llm_settings(
    payload: UpdateLlmSettingsRequest,
    user_id: str = Depends(get_user_id),
    db: Session = Depends(get_db),
):
    try:
        set_openai_api_key(db, payload.api_key, updated_by_user_id=user_id)
        return get_openai_api_key_status(db)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except (AppSettingDecryptError, AppSettingEncryptionMissing) as exc:
        raise _settings_error_response(exc) from exc


@router.delete("/llm", response_model=LlmSettingsResponse)
@router.delete("/openai", response_model=LlmSettingsResponse, include_in_schema=False)
def delete_llm_settings(
    user_id: str = Depends(get_user_id),
    db: Session = Depends(get_db),
):
    del user_id
    clear_openai_api_key(db)
    try:
        return get_openai_api_key_status(db)
    except (AppSettingDecryptError, AppSettingEncryptionMissing) as exc:
        raise _settings_error_response(exc) from exc
