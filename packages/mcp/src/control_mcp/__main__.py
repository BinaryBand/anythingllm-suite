"""`anythingllm-mcp-control` (or `python -m control_mcp`) serves the tools to an MCP client over
stdio. The settings are in `control_mcp.settings`."""

from __future__ import annotations

import os

from control_mcp.bridge import Bridge
from control_mcp.server import build_server
from control_mcp.settings import Settings


def main() -> None:
    try:
        settings = Settings.from_env(os.environ)
    except ValueError as error:
        raise SystemExit(f"anythingllm-mcp-control: {error}") from error
    build_server(Bridge(settings.url, settings.key), settings.roles).run(transport="stdio")


if __name__ == "__main__":
    main()
