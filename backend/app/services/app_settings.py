import os
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from app.models import AppSetting
from app.security.data_encryption import decrypt_value, encrypt_value


OPENAI_API_KEY_SETTING = "openai_api_key"


class AppSettingEncryptionMissing(RuntimeError):
    pass


class AppSettingDecryptError(RuntimeError):
    pass


def _normalize_api_key(api_key: Optional[str]) -> Optional[str]:
    value = (api_key or "").strip()
    return value or None


def get_encrypted_openai_api_key(db: Session) -> Optional[str]:
    setting = db.query(AppSetting).filter(AppSetting.key == OPENAI_API_KEY_SETTING).first()
    if not setting or not setting.value_encrypted:
        return None

    try:
        return _normalize_api_key(decrypt_value(setting.value_encrypted))
    except ValueError as exc:
        raise AppSettingDecryptError("Stored OpenAI API key could not be decrypted.") from exc


def get_openai_api_key(db: Session) -> Optional[str]:
    return get_encrypted_openai_api_key(db) or _normalize_api_key(os.getenv("OPENAI_API_KEY"))


def get_openai_api_key_status(db: Session) -> dict:
    has_database_key = False
    try:
        has_database_key = get_encrypted_openai_api_key(db) is not None
    except AppSettingDecryptError:
        raise

    has_environment_key = _normalize_api_key(os.getenv("OPENAI_API_KEY")) is not None
    source = "database" if has_database_key else "environment" if has_environment_key else "none"

    return {
        "configured": has_database_key or has_environment_key,
        "source": source,
        "database_configured": has_database_key,
        "environment_configured": has_environment_key,
    }


def set_openai_api_key(db: Session, api_key: str, updated_by_user_id: Optional[str]) -> None:
    normalized = _normalize_api_key(api_key)
    if normalized is None:
        raise ValueError("OpenAI API key is required.")

    setting = db.query(AppSetting).filter(AppSetting.key == OPENAI_API_KEY_SETTING).first()
    now = datetime.utcnow()
    value_encrypted = encrypt_value(normalized)
    if value_encrypted is None:
        raise AppSettingEncryptionMissing(
            "DATA_ENCRYPTION_KEY_CURRENT is required to store OpenAI API keys in settings."
        )

    if setting is None:
        setting = AppSetting(
            key=OPENAI_API_KEY_SETTING,
            value_encrypted=value_encrypted,
            updated_by_user_id=updated_by_user_id,
            created_at=now,
            updated_at=now,
        )
        db.add(setting)
    else:
        setting.value_encrypted = value_encrypted
        setting.updated_by_user_id = updated_by_user_id
        setting.updated_at = now

    db.commit()


def clear_openai_api_key(db: Session) -> None:
    db.query(AppSetting).filter(AppSetting.key == OPENAI_API_KEY_SETTING).delete()
    db.commit()
