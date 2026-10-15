"""world_mcp against the real thing: the bridge (built from packages/bridge, with the default
BRIDGE_ALLOW) in front of a real AnythingLLM, which tools/e2e starts and names in the environment:

  E2E_BRIDGE_URL, E2E_DEVELOPER_KEY   the bridge and a developer key AnythingLLM accepts
  E2E_WORKSPACE                       the slug of the one workspace it holds

Run through `tools/e2e`; on its own these tests are skipped."""

import asyncio
import os
import sys

import httpx
import pytest
from mcp import Client
from mcp.client.stdio import StdioServerParameters

URL = os.environ.get("E2E_BRIDGE_URL", "")
KEY = os.environ.get("E2E_DEVELOPER_KEY", "")
WORKSPACE = os.environ.get("E2E_WORKSPACE", "")

pytestmark = pytest.mark.skipif(not URL, reason="run it through tools/e2e")


def world(url: str, key: str) -> tuple[bool, str]:
    """(is_error, what the agent is told) from world_workspaces, the server started as a client
    starts it."""
    env = {**os.environ, "ANYTHINGLLM_BRIDGE_URL": url, "ANYTHINGLLM_DEVELOPER_KEY": key}
    parameters = StdioServerParameters(command=sys.executable, args=["-m", "world_mcp"], env=env)

    async def ask() -> tuple[bool, str]:
        async with Client(parameters, read_timeout_seconds=60) as client:
            result = await client.call_tool("world_workspaces", {})
        return result.is_error, "".join(getattr(part, "text", "") for part in result.content)

    return asyncio.run(ask())


def test_the_agent_gets_the_workspaces_anythingllm_holds() -> None:
    is_error, text = world(URL, KEY)
    assert not is_error, text
    assert f'"workspace": "{WORKSPACE}"' in text
    assert "E2E Workspace" in text


def test_a_key_anythingllm_does_not_accept_is_said_so() -> None:
    is_error, text = world(URL, "not-a-key")
    assert is_error
    assert "401" in text


def test_a_bridge_that_is_not_there_is_said_so() -> None:
    is_error, text = world("http://127.0.0.1:9", KEY)  # the discard port: nothing listens
    assert is_error
    assert "unreachable" in text


def test_the_bridge_passes_what_the_default_list_names_and_nothing_else() -> None:
    headers = {"Authorization": f"Bearer {KEY}"}
    assert httpx.get(f"{URL}/workspaces", headers=headers).status_code == httpx.codes.OK
    assert httpx.get(f"{URL}/workspaces").status_code == httpx.codes.UNAUTHORIZED
    refused = httpx.get(f"{URL}/system/api-keys", headers=headers)  # every key's secret
    assert refused.status_code == httpx.codes.FORBIDDEN
    assert "doesn't pass" in refused.text
