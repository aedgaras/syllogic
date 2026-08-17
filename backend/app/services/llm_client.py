import logging
from typing import Optional

from sqlalchemy.orm import Session

from app.services.app_settings import get_llm_base_url, get_openai_api_key


logger = logging.getLogger(__name__)


def create_llm_client(db: Session) -> Optional[object]:
    """Create a client for OpenAI or an OpenAI-compatible endpoint."""
    try:
        from openai import OpenAI
    except ImportError:
        logger.warning("OpenAI compatibility library is not installed")
        return None

    api_key = get_openai_api_key(db)
    if not api_key:
        return None

    options = {"api_key": api_key}
    base_url = get_llm_base_url()
    if base_url:
        options["base_url"] = base_url
    return OpenAI(**options)
