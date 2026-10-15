"""control_mcp as an MCP client runs it (`python -m control_mcp` over stdio) against the fake
AnythingLLM behind a stand-in bridge on a free port: the address, key and roles come from the
environment and a call crosses real HTTP. tools/e2e does the same against the real thing."""

import asyncio
import subprocess
import sys

from fakes import FakeAnythingLlm, serve
from mcp import Client
from stdio import server_params, text_of

KEY = "stdio-key"


async def ask(port: int) -> tuple[set[str], str, str]:
    params = server_params(f"http://127.0.0.1:{port}", KEY, "chat,schedule")
    async with Client(params, read_timeout_seconds=30) as client:
        names = {t.name for t in (await client.list_tools()).tools}
        workspaces = await client.call_tool("chat_workspaces", {})
        jobs = await client.call_tool("schedule", {"action": "list"})
    return names, text_of(workspaces), text_of(jobs)


def test_the_server_calls_the_bridge_in_its_environment_with_its_key_and_roles() -> None:
    keys: list[str] = []
    server = serve(FakeAnythingLlm(), keys)
    try:
        names, workspaces, jobs = asyncio.run(ask(server.server_port))
    finally:
        server.shutdown()
    assert {"chat_workspaces", "schedule"} <= names
    assert "Home" in workspaces
    assert "Morning news" in jobs
    assert keys
    assert set(keys) == {f"Bearer {KEY}"}


def test_a_role_that_does_not_exist_stops_the_server_with_the_reason() -> None:
    run = subprocess.run(
        [sys.executable, "-m", "control_mcp"],
        env=server_params("http://127.0.0.1:9", KEY, "admin").env,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert run.returncode != 0
    assert "one or more of chat, schedule" in run.stderr
