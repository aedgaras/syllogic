import base64

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models import AppSetting, User
from app.security.data_encryption import reset_encryption_config_cache
from app.services.app_settings import (
    clear_openai_api_key,
    get_openai_api_key,
    get_openai_api_key_status,
    set_openai_api_key,
)


def _session():
    engine = create_engine("sqlite:///:memory:")
    User.__table__.create(bind=engine)
    AppSetting.__table__.create(bind=engine)
    Session = sessionmaker(bind=engine)
    return Session()


def _set_encryption_key(monkeypatch):
    key = base64.urlsafe_b64encode(b"s" * 32).decode("utf-8").rstrip("=")
    monkeypatch.setenv("DATA_ENCRYPTION_KEY_CURRENT", key)
    monkeypatch.setenv("DATA_ENCRYPTION_KEY_ID", "k-test-app-settings")
    monkeypatch.delenv("DATA_ENCRYPTION_KEY_PREVIOUS", raising=False)
    reset_encryption_config_cache()


def test_openai_api_key_uses_environment_fallback(monkeypatch):
    db = _session()
    monkeypatch.setenv("OPENAI_API_KEY", "sk-env")

    assert get_openai_api_key(db) == "sk-env"
    assert get_openai_api_key_status(db) == {
        "configured": True,
        "source": "environment",
        "database_configured": False,
        "environment_configured": True,
    }


def test_saved_openai_api_key_overrides_environment(monkeypatch):
    db = _session()
    _set_encryption_key(monkeypatch)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-env")

    set_openai_api_key(db, "sk-db", updated_by_user_id=None)

    assert get_openai_api_key(db) == "sk-db"
    assert get_openai_api_key_status(db)["source"] == "database"
    stored = db.query(AppSetting).one()
    assert "sk-db" not in stored.value_encrypted


def test_clear_openai_api_key_restores_environment_fallback(monkeypatch):
    db = _session()
    _set_encryption_key(monkeypatch)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-env")

    set_openai_api_key(db, "sk-db", updated_by_user_id=None)
    clear_openai_api_key(db)

    assert get_openai_api_key(db) == "sk-env"
    assert get_openai_api_key_status(db)["source"] == "environment"
