import logging
from typing import List, Optional, Tuple

from sqlalchemy.orm import Session

from app.services.app_settings import (
    get_llm_base_url,
    get_llm_fallback_api_key,
    get_llm_fallback_base_url,
    get_llm_fallback_model,
    get_llm_model,
    get_openai_api_key,
)


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


def create_llm_fallback_client() -> Optional[object]:
    """Create a client for the deployment-configured fallback provider.

    Unlike the primary client, this is env-only (LLM_FALLBACK_BASE_URL /
    LLM_FALLBACK_API_KEY) — there is no per-user database setting for it,
    since it's meant to be a deployment-level safety net (e.g. a local
    Ollama/vLLM server) rather than something end users configure per call.
    """
    base_url = get_llm_fallback_base_url()
    if not base_url:
        return None

    try:
        from openai import OpenAI
    except ImportError:
        logger.warning("OpenAI compatibility library is not installed")
        return None

    return OpenAI(api_key=get_llm_fallback_api_key(), base_url=base_url)


def create_llm_clients(db: Session) -> List[Tuple[object, str, str]]:
    """Return ordered (client, model, label) tuples: primary first, then fallback.

    Callers should try providers in order, moving to the next one only when
    `is_fallback_worthy_error` classifies the failure as quota/auth-related.
    """
    providers: List[Tuple[object, str, str]] = []

    primary = create_llm_client(db)
    if primary is not None:
        providers.append((primary, get_llm_model(), "primary"))

    fallback = create_llm_fallback_client()
    if fallback is not None:
        providers.append((fallback, get_llm_fallback_model(), "fallback"))

    return providers


def is_fallback_worthy_error(exc: Exception) -> bool:
    """True when the error indicates the primary provider is unusable right
    now (invalid/expired key, exhausted quota, rate limited) rather than a
    transient issue worth retrying against the same provider.
    """
    message = str(exc).lower()
    return (
        "401" in message
        or "authentication" in message
        or "api key" in message
        or "429" in message
        or "rate limit" in message
        or "insufficient_quota" in message
        or "quota" in message
    )
