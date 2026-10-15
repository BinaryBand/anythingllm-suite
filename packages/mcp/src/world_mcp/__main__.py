"""`anythingllm-mcp-world` (or `python -m world_mcp`) serves the tool over stdio. It calls the
bridge at ANYTHINGLLM_BRIDGE_URL (default http://127.0.0.1:8467) with the developer key in
ANYTHINGLLM_DEVELOPER_KEY, which `anythingllm-bridge install` writes to
~/.config/anythingllm-mcp/<server>.env."""

from __future__ import annotations

import os

import httpx

from world_mcp.server import build_server


def main() -> None:
    url = os.environ.get("ANYTHINGLLM_BRIDGE_URL", "http://127.0.0.1:8467")
    key = os.environ.get("ANYTHINGLLM_DEVELOPER_KEY", "")
    bridge = httpx.AsyncClient(
        base_url=url, headers={"Authorization": f"Bearer {key}"}, timeout=30,
    )
    build_server(bridge).run(transport="stdio")


if __name__ == "__main__":
    main()
