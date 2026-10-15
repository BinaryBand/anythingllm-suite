"""What world_mcp asks of the bridge: the request it sends, what it makes of each answer, and that
the route is one the contract's default BRIDGE_ALLOW lists."""

import asyncio
import re
from pathlib import Path

import httpx
import pytest
from mcp.server.mcpserver.exceptions import ToolError

from world_mcp.server import build_server

DEFAULT_ALLOW = Path(__file__).resolve().parents[3] / "contract" / "default-allow.txt"
WORKSPACES = {"workspaces": [{"slug": "home", "name": "Home"}, {"slug": "work", "name": "Work"}]}


def call(handler: httpx.MockTransport) -> object:
    bridge = httpx.AsyncClient(
        base_url="http://bridge", headers={"Authorization": "Bearer k"}, transport=handler,
    )
    return asyncio.run(build_server(bridge).call_tool("world_workspaces", {}))


def seen_by(answer: httpx.Response) -> tuple[list[httpx.Request], object]:
    requests: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return answer

    return requests, call(httpx.MockTransport(handle))


def allowed(rules: list[str], method: str, path: str) -> bool:
    """Whether `BRIDGE_ALLOW` rules pass a call, as allow.mts reads them: `[METHOD ]/path/prefix`
    (no method: GET, POST, PUT or DELETE), whole segments, a `*` for any one."""
    for rule in rules:
        rule_method, _, rule_path = rule.rpartition(" ")
        pattern = re.escape(rule_path).replace(r"\*", "[^/]+")
        methods = [rule_method] if rule_method else ["GET", "POST", "PUT", "DELETE"]
        if method in methods and re.match(pattern + r"(/|$)", path):
            return True
    return False


def test_the_allow_check_would_catch_a_route_the_list_lacks() -> None:
    rules = ["/workspaces", "GET /workspace/*/threads", "DELETE /workspace/*/thread/*"]
    assert allowed(rules, "GET", "/workspaces")
    assert allowed(rules, "GET", "/workspace/home/threads")
    assert allowed(rules, "DELETE", "/workspace/home/thread/a/delete-edited-chats")
    assert not allowed(rules, "POST", "/workspace/home/threads")
    assert not allowed(rules, "PATCH", "/workspaces")
    assert not allowed(rules, "GET", "/workspaces-secret/x")
    assert not allowed(rules, "GET", "/system/api-keys")


def test_it_asks_for_the_workspaces_with_the_developer_key() -> None:
    requests, result = seen_by(httpx.Response(200, json=WORKSPACES))
    assert [(r.method, r.url.path, r.headers["authorization"]) for r in requests] == [
        ("GET", "/workspaces", "Bearer k"),
    ]
    assert "home" in str(result)
    assert "Work" in str(result)


def test_the_route_it_calls_is_in_the_default_bridge_allow() -> None:
    requests, _ = seen_by(httpx.Response(200, json=WORKSPACES))
    rules = [
        line.strip()
        for line in DEFAULT_ALLOW.read_text().splitlines()
        if line.strip() and not line.startswith("#")
    ]
    for request in requests:
        assert allowed(rules, request.method, request.url.path), (request.method, request.url.path)


@pytest.mark.parametrize(
    ("status", "reason"),
    [(401, "401"), (403, "the bridge doesn't pass GET /workspaces"), (502, "502")],
)
def test_a_refusal_reaches_the_agent_as_the_bridge_said_it(status: int, reason: str) -> None:
    answer = httpx.Response(status, json={"error": "the bridge doesn't pass GET /workspaces"})
    with pytest.raises(ToolError, match=reason):
        seen_by(answer)


def test_an_unreachable_bridge_is_said_so() -> None:
    def refuse(_: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")

    with pytest.raises(ToolError, match="unreachable"):
        call(httpx.MockTransport(refuse))
