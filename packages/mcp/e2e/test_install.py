"""The control server installed into AnythingLLM's storage by `anythingllm-mcp-control install`
and loaded by a real AnythingLLM through the socket. tools/e2e sets it up with podman (the
container's user is the host user, so the socket is reachable) and names AnythingLLM in the
environment:

  E2E_ALLM_URL, E2E_ALLM_TOKEN   AnythingLLM and a login token for its internal API

Run through `tools/e2e`; on its own, or with docker, these tests are skipped."""

import os

import httpx
import pytest

URL = os.environ.get("E2E_ALLM_URL", "")
TOKEN = os.environ.get("E2E_ALLM_TOKEN", "")

pytestmark = pytest.mark.skipif(not URL, reason="run it through tools/e2e with podman")


def test_anythingllm_starts_the_installed_server_through_its_socket_and_lists_its_tools() -> None:
    headers = {"Authorization": f"Bearer {TOKEN}"}
    reloaded = httpx.get(f"{URL}/api/mcp-servers/force-reload", headers=headers, timeout=120)
    assert reloaded.status_code == httpx.codes.OK, reloaded.text
    listed = httpx.get(f"{URL}/api/mcp-servers/list", headers=headers, timeout=120).json()
    servers = {server["name"]: server for server in listed["servers"]}
    control = servers["control"]
    assert control["running"], control
    names = {tool["name"] for tool in control["tools"]}
    assert {"chat_workspaces", "chat_delete", "schedule"} <= names, names
