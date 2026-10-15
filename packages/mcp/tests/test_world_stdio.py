"""world_mcp as an MCP client runs it (`python -m world_mcp` over stdio) against a stand-in for the
bridge on a free port: the server reads its address and key from its environment and the call
crosses real HTTP."""

import asyncio
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

from mcp import Client
from mcp.client.stdio import StdioServerParameters

KEY = "stdio-key"
seen: list[tuple[str, str, str]] = []


class StandInBridge(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        seen.append((self.command, self.path, self.headers.get("Authorization", "")))
        body = json.dumps({"workspaces": [{"slug": "home", "name": "Home"}]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args: object) -> None:
        pass


async def ask(port: int) -> str:
    env = {
        **os.environ,
        "ANYTHINGLLM_BRIDGE_URL": f"http://127.0.0.1:{port}",
        "ANYTHINGLLM_DEVELOPER_KEY": KEY,
    }
    parameters = StdioServerParameters(command=sys.executable, args=["-m", "world_mcp"], env=env)
    async with Client(parameters, read_timeout_seconds=30) as client:
        tools = (await client.list_tools()).tools
        assert {t.name for t in tools} == {"world_workspaces"}
        result = await client.call_tool("world_workspaces", {})
    return "".join(getattr(part, "text", "") for part in result.content)


def test_the_server_calls_the_bridge_named_in_its_environment_with_its_key() -> None:
    server = HTTPServer(("127.0.0.1", 0), StandInBridge)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        text = asyncio.run(ask(server.server_port))
    finally:
        server.shutdown()
    assert seen == [("GET", "/workspaces", f"Bearer {KEY}")]
    assert "Home" in text
