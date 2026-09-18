"""
Entry point for the Syllogic MCP Server.

Usage:
    stdio mode (for Claude Desktop):
        python mcp_server.py

    HTTP mode (for web deployment):
        uvicorn mcp_server:app --port 8001

    Using FastMCP CLI:
        fastmcp run mcp_server.py
"""

import os

from starlette.responses import JSONResponse

from app.logging_config import configure_logging
from app.mcp.server import mcp
from app.rate_limit import IPRateLimitMiddleware

# The compose service passes LOG_LEVEL/LOG_FORMAT, but nothing here ever acted
# on them: without this the root logger keeps its default configuration and the
# server's own tool-call logs are discarded.
configure_logging()


def _bounded_env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        value = default
    return max(minimum, min(maximum, value))


# HTTP app for uvicorn deployment
app = mcp.http_app()
# Per-IP throttling, which is what stops unauthenticated key guessing. It is
# deliberately blunt: everyone behind one egress address shares a bucket, so
# raise it where several people reach the server through the same NAT. The
# per-user limiter in app/mcp/middleware.py handles authenticated traffic.
app.add_middleware(
    IPRateLimitMiddleware,
    max_requests=_bounded_env_int("MCP_IP_RATE_LIMIT", 60, 1, 100_000),
    window_seconds=_bounded_env_int("MCP_IP_RATE_LIMIT_WINDOW", 60, 1, 3600),
)


async def health(_request):
    return JSONResponse({"status": "healthy", "service": "mcp"})


app.add_route("/health", health, methods=["GET"])

if __name__ == "__main__":
    # Run in stdio mode for Claude Desktop
    mcp.run()
