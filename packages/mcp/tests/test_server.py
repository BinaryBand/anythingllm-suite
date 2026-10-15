import pytest
from fakes import FakeAnythingLlm
from mcp.server.mcpserver.exceptions import ToolError

from control_mcp.bridge import Bridge
from control_mcp.server import build_server

CHAT = {
    "chat_workspaces",
    "chat_list",
    "chat_history",
    "chat_new",
    "chat_rename",
    "chat_clear",
    "chat_delete",
}
BOTH = ("chat", "schedule")
JOB = {"name": "Digest", "prompt": "Summarise.", "cron": "0 7 * * 1"}


async def test_a_role_not_asked_for_has_no_tools() -> None:
    fake = FakeAnythingLlm()
    wanted = [(("chat",), CHAT), (("schedule",), {"schedule"}), (BOTH, CHAT | {"schedule"})]
    for roles, names in wanted:
        tools = await build_server(fake.bridge(), roles).list_tools()
        assert {t.name for t in tools} == names
        assert all(t.description for t in tools)


def test_a_role_that_does_not_exist_is_refused_not_served_as_an_empty_server() -> None:
    with pytest.raises(ValueError, match="no such role: chta; the roles are chat, schedule"):
        build_server(FakeAnythingLlm().bridge(), ("chta",))


async def test_both_roles_stay_under_the_ten_tools_anythingllm_warns_about() -> None:
    assert len(await build_server(FakeAnythingLlm().bridge(), BOTH).list_tools()) <= 10


async def test_a_clear_is_two_calls_and_the_first_changes_nothing() -> None:
    fake = FakeAnythingLlm()
    server = build_server(fake.bridge())
    await server.call_tool("chat_clear", {"workspace": "home", "chat": "aaa-1"})
    assert len(fake.chats["aaa-1"]) == 2
    await server.call_tool("chat_clear", {"workspace": "home", "chat": "aaa-1", "apply": True})
    assert fake.chats["aaa-1"] == []


async def test_an_add_is_two_calls_and_the_first_changes_nothing() -> None:
    fake = FakeAnythingLlm()
    server = build_server(fake.bridge(), BOTH)
    await server.call_tool("schedule", {"action": "add", **JOB})
    assert len(fake.jobs) == 1
    await server.call_tool("schedule", {"action": "add", **JOB, "apply": True})
    assert len(fake.jobs) == 2


async def test_an_action_that_lacks_what_it_needs_says_what() -> None:
    fake = FakeAnythingLlm()
    server = build_server(fake.bridge(), ("schedule",))
    for args, lacks in [
        ({"action": "add", "name": "n", "prompt": "p"}, "schedule add needs cron"),
        ({"action": "add"}, "schedule add needs name"),
        ({"action": "update", "enabled": False}, "schedule update needs job"),
        ({"action": "delete"}, "schedule delete needs job"),
    ]:
        with pytest.raises(ToolError, match=lacks):
            await server.call_tool("schedule", args)
    with pytest.raises(ToolError):
        await server.call_tool("schedule", {"action": "run"})
    assert not [c for c in fake.calls if c[0] != "GET"]


async def test_what_went_wrong_reaches_the_agent_in_words() -> None:
    server = build_server(FakeAnythingLlm().bridge(), BOTH)
    with pytest.raises(ToolError, match="has no chat 'nope'"):
        await server.call_tool("chat_delete", {"workspace": "home", "chat": "nope"})
    with pytest.raises(ToolError, match="must be a slug"):
        await server.call_tool("chat_list", {"workspace": "../x"})
    with pytest.raises(ToolError, match="cron expression in UTC"):
        await server.call_tool("schedule", {"action": "add", **JOB, "cron": "daily", "apply": True})
    with pytest.raises(ToolError, match="Job not found"):
        await server.call_tool("schedule", {"action": "delete", "job": 9})


async def test_the_bridges_refusal_is_said_as_it_is() -> None:
    fake = FakeAnythingLlm()
    fake.answer = lambda *_: (403, {"error": "the bridge doesn't pass GET /workspaces"})  # type: ignore[method-assign]
    server = build_server(Bridge("http://b", "k", transport=fake.transport()))
    with pytest.raises(ToolError, match=r"^.*403: the bridge doesn't pass GET /workspaces$"):
        await server.call_tool("chat_workspaces", {})
