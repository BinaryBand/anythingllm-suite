"""Every route a tool calls is one the contract's default BRIDGE_ALLOW passes, so a route added to
a tool and not to contract/default-allow.txt fails here, before the bridge answers 403."""

import re
from pathlib import Path

from fakes import FakeAnythingLlm

from control_mcp.server import build_server

DEFAULT_ALLOW = Path(__file__).resolve().parents[3] / "contract" / "default-allow.txt"
METHODS = ["GET", "POST", "PUT", "DELETE"]


def allowed(rules: list[str], method: str, path: str) -> bool:
    """Whether `BRIDGE_ALLOW` rules pass a call, as allow.mts reads them: `[METHOD ]/path/prefix`
    (no method: GET, POST, PUT or DELETE), whole segments, a `*` for any one. A copy, since Python
    cannot import allow.mts; `make e2e` runs the same tool calls through the real bridge."""
    for rule in rules:
        rule_method, _, rule_path = rule.rpartition(" ")
        pattern = re.escape(rule_path).replace(r"\*", "[^/]+")
        if method in ([rule_method] if rule_method else METHODS) and re.match(
            pattern + r"(/|$)", path
        ):
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


async def test_every_route_the_tools_call_is_in_the_default_bridge_allow() -> None:
    fake = FakeAnythingLlm()
    server = build_server(fake.bridge(), ("chat", "schedule"))
    home = {"workspace": "home"}
    chat = {**home, "chat": "aaa-1"}
    job = {"name": "Digest", "prompt": "Summarise.", "cron": "0 7 * * 1"}
    for tool, args in [
        ("chat_workspaces", {}),
        ("chat_list", home),
        ("chat_history", chat),
        ("chat_new", home),
        ("chat_rename", {**chat, "name": "Lisbon"}),
        ("chat_clear", {**chat, "apply": True}),
        ("chat_delete", {**home, "chat": "bbb-2", "apply": True}),
        ("schedule", {"action": "list"}),
        ("schedule", {"action": "add", **job, "apply": True}),
        ("schedule", {"action": "update", "job": 2, "enabled": False, "apply": True}),
        ("schedule", {"action": "delete", "job": 2, "apply": True}),
    ]:
        await server.call_tool(tool, args)
    rules = [
        line.strip()
        for line in DEFAULT_ALLOW.read_text().splitlines()
        if line.strip() and not line.startswith("#")
    ]
    called = {(method, path) for method, path, _ in fake.calls}
    assert ("DELETE", "/workspace/home/thread/aaa-1/delete-edited-chats") in called
    assert ("PUT", "/scheduled-jobs/2") in called
    for method, path in sorted(called):
        assert allowed(rules, method, path), (method, path)
