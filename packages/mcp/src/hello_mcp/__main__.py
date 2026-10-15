"""`anythingllm-mcp-hello` (or `python -m hello_mcp`) serves the tool over stdio."""

from __future__ import annotations

from hello_mcp.server import build_server


def main() -> None:
    build_server().run(transport="stdio")


if __name__ == "__main__":
    main()
