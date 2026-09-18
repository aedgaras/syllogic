"""Tests for how MCP transaction search builds its SQL.

These compile expressions against the Postgres dialect rather than running
them, so they need no database. What matters here is the shape of the query --
one indexable predicate per field, and a search term that can never be
interpreted as a regex.
"""

from __future__ import annotations

import pytest
from sqlalchemy.dialects import postgresql

from app.mcp.tools.transactions import _build_search_filter, escape_regex


def _compiled(match_mode: str, query: str = "Jumbo"):
    expr = _build_search_filter(query, match_mode)
    compiled = expr.compile(dialect=postgresql.dialect())
    return str(compiled), compiled.params


class TestEscapeRegex:
    @pytest.mark.parametrize(
        "raw, expected",
        [
            ("Jumbo", "Jumbo"),
            ("Albert Heijn", "Albert Heijn"),
            ("A+B", r"A\+B"),
            ("(a+)+b", r"\(a\+\)\+b"),
            ("[x]", r"\[x\]"),
            ("a.b", r"a\.b"),
            ("100$", r"100\$"),
            ("^start", r"\^start"),
            ("a|b", r"a\|b"),
            ("back\\slash", "back\\\\slash"),
            ("{2,3}", r"\{2,3\}"),
        ],
    )
    def test_metacharacters_are_escaped(self, raw, expected):
        assert escape_regex(raw) == expected

    def test_plain_text_is_untouched(self):
        assert escape_regex("Albert Heijn 123") == "Albert Heijn 123"


class TestWordMatch:
    def test_uses_a_single_regex_per_field(self):
        sql, params = _compiled("word")
        # Two predicates -- description and merchant -- and nothing more. The
        # previous implementation emitted eight ILIKE patterns per field.
        assert sql.count("~*") == 2
        assert "ilike" not in sql.lower()
        assert len(params) == 2

    def test_pattern_is_word_bounded(self):
        _, params = _compiled("word")
        assert set(params.values()) == {r"\yJumbo\y"}

    def test_search_term_cannot_inject_a_pattern(self):
        """A term full of regex metacharacters must be matched literally --
        otherwise a query like "(a+)+" is both wrong and a backtracking risk
        inside Postgres."""
        _, params = _compiled("word", "(a+)+b")
        assert set(params.values()) == {r"\y\(a\+\)\+b\y"}


class TestOtherModes:
    def test_contains_uses_ilike_wildcards(self):
        sql, params = _compiled("contains")
        assert sql.lower().count("ilike") == 2
        assert set(params.values()) == {"%Jumbo%"}

    def test_starts_with_anchors_the_pattern(self):
        sql, params = _compiled("starts_with")
        assert sql.lower().count("ilike") == 2
        assert set(params.values()) == {"Jumbo%"}

    def test_unknown_mode_falls_back_to_contains(self):
        _, params = _compiled("something_else")
        assert set(params.values()) == {"%Jumbo%"}
