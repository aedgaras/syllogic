"""
MCP (Model Context Protocol) server for Syllogic.

Usage:
    from app.mcp.server import mcp

The tools are grouped into toolsets (app/mcp/toolsets.py) and only `core` is
listed when a session opens; the rest arrive via `load_toolset`, or via
`?toolsets=...` on the connection. `python -c "import asyncio, app.mcp.server
as s; print(asyncio.run(s.mcp.list_tools()))"` is the authoritative list --
an inventory in this docstring only goes stale.

Toolsets:
    core              accounts, categories, transaction browsing and search,
                      spending/income/cashflow analytics, people
    edit_transactions create, edit, delete and recategorize transactions
    budgets           budgets, their pace and their history
    recurring         subscriptions and recurring bills
    investments       holdings, portfolio value, trades
    reports           scheduled email reports
"""
