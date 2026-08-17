from types import SimpleNamespace

from app.routes import llm


def test_column_mapping_uses_configured_model(monkeypatch):
    captured = {}

    class StubCompletions:
        @staticmethod
        def create(**kwargs):
            captured.update(kwargs)
            content = """```json
            {"date":"Booked","amount":"Value","description":null,
             "merchant":null,"transactionType":null,"fee":null,"state":null,
             "startingBalance":null,"endingBalance":null,
             "typeConfig":{"isAmountSigned":true,"amountFormat":"DOT_DECIMAL",
             "dateFormat":"YYYY-MM-DD"}}
            ```"""
            return SimpleNamespace(
                choices=[SimpleNamespace(message=SimpleNamespace(content=content))]
            )

    client = SimpleNamespace(
        chat=SimpleNamespace(completions=StubCompletions())
    )
    monkeypatch.setattr(llm, "create_llm_client", lambda db: client)
    monkeypatch.setenv("LLM_MODEL", "qwen3:8b")

    result = llm.map_csv_columns(
        llm.ColumnMappingRequest(
            headers=["Booked", "Value"],
            sample_rows=[["2026-08-17", "-12.50"]],
            date_formats=["YYYY-MM-DD", "DD-MM-YYYY"],
        ),
        db=object(),
    )

    assert captured["model"] == "qwen3:8b"
    assert result["mapping"]["date"] == "Booked"
    assert "2026-08-17" in captured["messages"][0]["content"]


def test_column_mapping_reports_missing_configuration(monkeypatch):
    monkeypatch.setattr(llm, "create_llm_client", lambda db: None)

    try:
        llm.map_csv_columns(
            llm.ColumnMappingRequest(
                headers=["Date"],
                sample_rows=[],
                date_formats=["DD-MM-YYYY"],
            ),
            db=object(),
        )
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 503
    else:
        raise AssertionError("Expected missing LLM configuration to fail")
