import json
import os
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from app.models import AppSetting
from app.security.data_encryption import decrypt_value, encrypt_value


OPENAI_API_KEY_SETTING = "openai_api_key"
DEFAULT_LLM_MODEL = "gpt-4o-mini"

LLM_MODEL_SETTING = "llm_model"

AI_SUMMARY_ENABLED_SETTING = "ai_summary_enabled"
DEFAULT_AI_SUMMARY_ENABLED = False

LOG_LEVEL_SETTING = "log_level"
VALID_LOG_LEVELS = {"debug", "info", "warn", "error"}
DEFAULT_LOG_LEVEL = "info"
OPENAI_DEFAULT_BASE_URLS = {
    "https://api.openai.com",
    "https://api.openai.com/",
    "https://api.openai.com/v1",
    "https://api.openai.com/v1/",
}


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
        raise AppSettingDecryptError("Stored LLM API key could not be decrypted.") from exc


def get_openai_api_key(db: Session) -> Optional[str]:
    """Return the configured LLM key, retaining the legacy function name.

    A key saved in the database has highest priority. LLM_API_KEY is the
    provider-neutral deployment variable; OPENAI_API_KEY remains supported.
    OpenAI-compatible local endpoints commonly ignore the key, but both OpenAI
    SDKs require a non-empty value, so use a harmless placeholder in that case.
    """
    saved_key = get_encrypted_openai_api_key(db)
    if saved_key:
        return saved_key

    environment_key = _normalize_api_key(os.getenv("LLM_API_KEY")) or _normalize_api_key(
        os.getenv("OPENAI_API_KEY")
    )
    if environment_key:
        return environment_key

    if get_llm_base_url():
        return "local-llm"
    return None


def get_llm_base_url() -> Optional[str]:
    """Return an optional OpenAI-compatible API base URL."""
    return _normalize_api_key(os.getenv("LLM_BASE_URL")) or _normalize_api_key(
        os.getenv("OPENAI_BASE_URL")
    )


def get_llm_model() -> str:
    """Return the model used for all LLM features."""
    return (
        _normalize_api_key(os.getenv("LLM_MODEL"))
        or _normalize_api_key(os.getenv("CATEGORIZATION_LLM_MODEL"))
        or DEFAULT_LLM_MODEL
    )


def get_llm_model_override(db: Session) -> Optional[str]:
    """Return the database-stored model override, if any.

    Stored the same way as log_level (see get_log_level_override): plaintext
    or encrypted JSON in the shared app_settings table.
    """
    setting = db.query(AppSetting).filter(AppSetting.key == LLM_MODEL_SETTING).first()
    if not setting or not setting.value_encrypted:
        return None

    try:
        raw = decrypt_value(setting.value_encrypted)
    except ValueError:
        return None
    if not raw:
        return None

    try:
        model = json.loads(raw).get("model")
    except (ValueError, AttributeError):
        return None

    return _normalize_api_key(model)


def get_effective_llm_model(db: Session) -> str:
    """Return the model to use: database override, then env, then default."""
    return get_llm_model_override(db) or get_llm_model()


def set_llm_model(db: Session, model: str, updated_by_user_id: Optional[str]) -> str:
    normalized = _normalize_api_key(model)
    if normalized is None:
        raise ValueError("Model is required.")

    serialized = json.dumps({"model": normalized})
    value_encrypted = encrypt_value(serialized) or serialized

    setting = db.query(AppSetting).filter(AppSetting.key == LLM_MODEL_SETTING).first()
    now = datetime.now(timezone.utc)
    if setting is None:
        setting = AppSetting(
            key=LLM_MODEL_SETTING,
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
    return normalized


def clear_llm_model(db: Session) -> None:
    db.query(AppSetting).filter(AppSetting.key == LLM_MODEL_SETTING).delete()
    db.commit()


def get_llm_fallback_base_url() -> Optional[str]:
    """Return an optional OpenAI-compatible base URL used when the primary
    provider is unavailable (out of quota, invalid key). Deployment-only —
    there is no per-user database setting for the fallback provider.
    """
    return _normalize_api_key(os.getenv("LLM_FALLBACK_BASE_URL"))


def get_llm_fallback_model() -> str:
    """Return the model used against the fallback provider."""
    return _normalize_api_key(os.getenv("LLM_FALLBACK_MODEL")) or DEFAULT_LLM_MODEL


def get_llm_fallback_api_key() -> str:
    """Return the API key for the fallback provider.

    Local OpenAI-compatible servers (Ollama, vLLM, LocalAI) commonly ignore
    the key, but the OpenAI SDK requires a non-empty value.
    """
    return _normalize_api_key(os.getenv("LLM_FALLBACK_API_KEY")) or "local-llm"


def _is_custom_llm_endpoint(base_url: Optional[str]) -> bool:
    known_urls = {url.rstrip("/") for url in OPENAI_DEFAULT_BASE_URLS}
    return bool(base_url and base_url.rstrip("/") not in known_urls)


def get_openai_api_key_status(db: Session) -> dict:
    has_database_key = False
    try:
        has_database_key = get_encrypted_openai_api_key(db) is not None
    except AppSettingDecryptError:
        raise

    has_environment_key = (
        _normalize_api_key(os.getenv("LLM_API_KEY")) is not None
        or _normalize_api_key(os.getenv("OPENAI_API_KEY")) is not None
    )
    base_url = get_llm_base_url()
    has_environment_config = has_environment_key or bool(base_url)
    source = "database" if has_database_key else "environment" if has_environment_config else "none"

    return {
        "configured": has_database_key or has_environment_config,
        "source": source,
        "database_configured": has_database_key,
        "environment_configured": has_environment_config,
        "base_url": base_url,
        "model": get_effective_llm_model(db),
        "provider": "custom" if _is_custom_llm_endpoint(base_url) else "openai",
    }


def set_openai_api_key(db: Session, api_key: str, updated_by_user_id: Optional[str]) -> None:
    normalized = _normalize_api_key(api_key)
    if normalized is None:
        raise ValueError("LLM API key is required.")

    setting = db.query(AppSetting).filter(AppSetting.key == OPENAI_API_KEY_SETTING).first()
    now = datetime.now(timezone.utc)
    value_encrypted = encrypt_value(normalized)
    if value_encrypted is None:
        raise AppSettingEncryptionMissing(
            "DATA_ENCRYPTION_KEY_CURRENT is required to store LLM API keys in settings."
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


def _env_log_level() -> Optional[str]:
    value = (os.getenv("LOG_LEVEL") or "").strip().lower()
    return value if value in VALID_LOG_LEVELS else None


def get_log_level_override(db: Session) -> Optional[str]:
    """Return the database-stored log level, if any.

    Stored the same way as other non-secret app_settings rows (see
    frontend's registration-settings.ts): encrypted when a data encryption
    key is configured, plaintext JSON otherwise. Shares the "log_level" key
    with the frontend's own app_settings row, so a change made in either
    app's Settings UI is visible to both (they read the same Postgres table).
    """
    setting = db.query(AppSetting).filter(AppSetting.key == LOG_LEVEL_SETTING).first()
    if not setting or not setting.value_encrypted:
        return None

    try:
        raw = decrypt_value(setting.value_encrypted)
    except ValueError:
        return None
    if not raw:
        return None

    try:
        level = json.loads(raw).get("level")
    except (ValueError, AttributeError):
        return None

    return level if level in VALID_LOG_LEVELS else None


def get_log_level_status(db: Session) -> dict:
    override = get_log_level_override(db)
    if override:
        return {"level": override, "source": "database"}

    env_level = _env_log_level()
    if env_level:
        return {"level": env_level, "source": "environment"}

    return {"level": DEFAULT_LOG_LEVEL, "source": "default"}


def get_effective_log_level(db: Session) -> str:
    return get_log_level_status(db)["level"]


def set_log_level(db: Session, level: str, updated_by_user_id: Optional[str]) -> dict:
    normalized = (level or "").strip().lower()
    if normalized not in VALID_LOG_LEVELS:
        raise ValueError(f"Log level must be one of {sorted(VALID_LOG_LEVELS)}.")

    serialized = json.dumps({"level": normalized})
    value_encrypted = encrypt_value(serialized) or serialized

    setting = db.query(AppSetting).filter(AppSetting.key == LOG_LEVEL_SETTING).first()
    now = datetime.now(timezone.utc)
    if setting is None:
        setting = AppSetting(
            key=LOG_LEVEL_SETTING,
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
    return {"level": normalized, "source": "database"}


def clear_log_level(db: Session) -> dict:
    db.query(AppSetting).filter(AppSetting.key == LOG_LEVEL_SETTING).delete()
    db.commit()
    return get_log_level_status(db)


def _get_ai_summary_enabled_override(db: Session) -> Optional[bool]:
    setting = db.query(AppSetting).filter(AppSetting.key == AI_SUMMARY_ENABLED_SETTING).first()
    if not setting or not setting.value_encrypted:
        return None

    try:
        raw = decrypt_value(setting.value_encrypted)
    except ValueError:
        return None
    if not raw:
        return None

    try:
        return bool(json.loads(raw).get("enabled"))
    except (ValueError, AttributeError):
        return None


def get_ai_summary_enabled_status(db: Session) -> dict:
    override = _get_ai_summary_enabled_override(db)
    if override is not None:
        return {"enabled": override, "source": "database"}
    return {"enabled": DEFAULT_AI_SUMMARY_ENABLED, "source": "default"}


def get_ai_summary_enabled(db: Session) -> bool:
    return get_ai_summary_enabled_status(db)["enabled"]


def set_ai_summary_enabled(db: Session, enabled: bool, updated_by_user_id: Optional[str]) -> dict:
    serialized = json.dumps({"enabled": bool(enabled)})
    value_encrypted = encrypt_value(serialized) or serialized

    setting = db.query(AppSetting).filter(AppSetting.key == AI_SUMMARY_ENABLED_SETTING).first()
    now = datetime.now(timezone.utc)
    if setting is None:
        setting = AppSetting(
            key=AI_SUMMARY_ENABLED_SETTING,
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
    return get_ai_summary_enabled_status(db)


def clear_ai_summary_enabled(db: Session) -> dict:
    db.query(AppSetting).filter(AppSetting.key == AI_SUMMARY_ENABLED_SETTING).delete()
    db.commit()
    return get_ai_summary_enabled_status(db)
