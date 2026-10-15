"""`anythingllm-mcp-control` (or `python -m control_mcp`) serves the tools to an MCP client over
stdio; `install` and `uninstall` put it where AnythingLLM can start it (`control_mcp.install`).
The settings are in `control_mcp.settings`."""

from __future__ import annotations

import argparse
import os
from collections.abc import Sequence
from pathlib import Path

from control_mcp import install
from control_mcp.bridge import Bridge
from control_mcp.server import build_server
from control_mcp.settings import Settings


def serve() -> None:
    try:
        settings = Settings.from_env(os.environ)
    except ValueError as error:
        raise SystemExit(f"anythingllm-mcp-control: {error}") from error
    build_server(Bridge(settings.url, settings.key), settings.roles).run(transport="stdio")


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="anythingllm-mcp-control", description="With no command, serves over stdio.",
    )
    commands = parser.add_subparsers(dest="command")
    add = commands.add_parser("install", help="put the server where AnythingLLM can start it")
    add.add_argument("--storage", type=Path, help="AnythingLLM's storage (default: the bridge's)")
    # None (not given) lets install choose: native only where systemd does not answer.
    add.add_argument("--native", action="store_true", default=None, help="no systemd, no relay")
    add.add_argument("--no-start", action="store_true", help="write the files, run no systemctl")
    drop = commands.add_parser("uninstall", help="stop and remove what install made")
    drop.add_argument("--storage", type=Path, help="AnythingLLM's storage (default: the bridge's)")
    args = parser.parse_args(argv)
    if args.command is None:
        serve()
        return
    done = (
        install.install(args.storage, native=args.native, start=not args.no_start)
        if args.command == "install"
        else install.uninstall(args.storage)
    )
    print("\n".join(done))  # noqa: T201 -- the command's answer to the person


if __name__ == "__main__":
    main()
