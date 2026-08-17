import openai

from app.services import llm_client


def test_create_llm_client_passes_custom_endpoint(monkeypatch):
    captured = {}
    sentinel = object()

    def fake_openai(**kwargs):
        captured.update(kwargs)
        return sentinel

    monkeypatch.setattr(openai, "OpenAI", fake_openai)
    monkeypatch.setattr(llm_client, "get_openai_api_key", lambda db: "local-key")
    monkeypatch.setattr(llm_client, "get_llm_base_url", lambda: "http://ollama:11434/v1")

    assert llm_client.create_llm_client(object()) is sentinel
    assert captured == {
        "api_key": "local-key",
        "base_url": "http://ollama:11434/v1",
    }
