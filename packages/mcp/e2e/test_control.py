"""control_mcp against the real thing: the bridge (built from packages/bridge, with the default
BRIDGE_ALLOW) in front of a real AnythingLLM, which tools/e2e starts and names in the environment:

  E2E_BRIDGE_URL, E2E_DEVELOPER_KEY   the bridge and a developer key AnythingLLM accepts
  E2E_WORKSPACE                       the slug of the one workspace it holds

Run through `tools/e2e`; on its own these tests are skipped. The server is started as an MCP
client starts it, over stdio. The throwaway AnythingLLM has no model, so a chat holds no exchanges:
clearing one that has some is covered against the fake, in tests/."""

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
import pytest
from mcp import Client
from stdio import server_params, text_of

URL = os.environ.get("E2E_BRIDGE_URL", "")
KEY = os.environ.get("E2E_DEVELOPER_KEY", "")
WORKSPACE = os.environ.get("E2E_WORKSPACE", "")

pytestmark = pytest.mark.skipif(not URL, reason="run it through tools/e2e")


@asynccontextmanager
async def server(
    roles: str = "chat,schedule", url: str = URL, key: str = KEY,
) -> AsyncIterator[Client]:
    async with Client(server_params(url, key, roles), read_timeout_seconds=60) as client:
        yield client


async def tool(client: Client, name: str, /, **arguments: object) -> tuple[bool, dict]:
    """(is_error, what the agent is told): the structured result, or the error's text as `why`."""
    result = await client.call_tool(name, arguments)
    if result.structured_content is not None:
        return result.is_error, result.structured_content
    return result.is_error, {"why": text_of(result)}


async def test_a_chat_is_found_started_renamed_and_deleted_in_the_real_anythingllm() -> None:
    async with server(roles="chat") as client:
        _, found = await tool(client, "chat_workspaces")
        assert {"workspace": WORKSPACE, "name": "E2E Workspace"} in found["workspaces"]

        _, made = await tool(client, "chat_new", workspace=WORKSPACE)
        chat = {"workspace": WORKSPACE, "chat": made["chat"]}
        _, listing = await tool(client, "chat_list", workspace=WORKSPACE)
        assert made["chat"] in [c["chat"] for c in listing["chats"]]

        _, renamed = await tool(client, "chat_rename", **chat, name="Lisbon trip")
        assert renamed == {"chat": made["chat"], "name": "Lisbon trip"}
        _, history = await tool(client, "chat_history", **chat)
        assert (history["name"], history["exchanges"], history["shown"]) == ("Lisbon trip", 0, [])
        _, cleared = await tool(client, "chat_clear", **chat, apply=True)
        assert cleared["applied"] is False
        assert "already empty" in cleared["note"]

        _, shown = await tool(client, "chat_delete", **chat)
        assert shown["applied"] is False
        _, listing = await tool(client, "chat_list", workspace=WORKSPACE)
        assert made["chat"] in [c["chat"] for c in listing["chats"]]
        _, done = await tool(client, "chat_delete", **chat, apply=True)
        assert done["deleted"] is True
        _, listing = await tool(client, "chat_list", workspace=WORKSPACE)
        assert made["chat"] not in [c["chat"] for c in listing["chats"]]
        is_error, why = await tool(client, "chat_delete", **chat)
        assert is_error
        assert "has no chat" in why["why"]


async def test_a_job_is_added_changed_and_deleted_in_the_real_anythingllm() -> None:
    new = {"name": "Digest", "prompt": "Summarise my week.", "cron": "0 7 * * 1"}
    async with server(roles="schedule") as client:
        _, before = await tool(client, "schedule", action="list")
        assert before["timezone"] == "UTC"

        _, shown = await tool(client, "schedule", action="add", **new)
        assert shown["applied"] is False
        _, still = await tool(client, "schedule", action="list")
        assert len(still["jobs"]) == len(before["jobs"])
        _, added = await tool(client, "schedule", action="add", **new, apply=True)
        job = added["job"]["id"]
        assert added["job"]["schedule"] == "0 7 * * 1"
        is_error, why = await tool(client, "schedule", action="add", **new, apply=True)
        assert is_error
        assert "identical job already exists" in why["why"]

        off = {"action": "update", "job": job, "enabled": False}
        _, changes = await tool(client, "schedule", **off)
        assert changes["changes"]["enabled"] == {"from": True, "to": False}
        _, updated = await tool(client, "schedule", **off, apply=True)
        assert updated["job"]["enabled"] is False
        late = {"action": "update", "job": job, "cron": "99 7 * * *"}
        is_error, why = await tool(client, "schedule", **late, apply=True)
        assert is_error
        assert "cron" in why["why"].lower()

        _, gone = await tool(client, "schedule", action="delete", job=job, apply=True)
        assert gone["deleted"] == job
        _, after = await tool(client, "schedule", action="list")
        assert job not in [j["id"] for j in after["jobs"]]


async def test_a_key_anythingllm_does_not_accept_is_said_so_without_the_json_around_it() -> None:
    async with server(key="not-a-key") as client:
        is_error, why = await tool(client, "chat_workspaces")
    assert is_error
    assert "401" in why["why"]
    assert "developer key" in why["why"]
    assert '{"error"' not in why["why"]


async def test_a_bridge_that_is_not_there_is_said_so() -> None:
    async with server(url="http://127.0.0.1:9") as client:  # the discard port: nothing listens
        is_error, why = await tool(client, "chat_workspaces")
    assert is_error
    assert "unreachable" in why["why"]


def test_the_bridge_passes_what_the_default_list_names_and_nothing_else() -> None:
    headers = {"Authorization": f"Bearer {KEY}"}
    assert httpx.get(f"{URL}/workspaces", headers=headers).status_code == httpx.codes.OK
    assert httpx.get(f"{URL}/workspaces").status_code == httpx.codes.UNAUTHORIZED
    refused = httpx.get(f"{URL}/system/api-keys", headers=headers)  # every key's secret
    assert refused.status_code == httpx.codes.FORBIDDEN
    assert "doesn't pass" in refused.text
