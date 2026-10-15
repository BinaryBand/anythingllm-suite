import httpx
import pytest

from control_mcp.bridge import Bridge, BridgeError, bounded, slug


def bridge(handler: httpx.MockTransport, key: str = "k") -> Bridge:
    return Bridge("http://bridge/", key, transport=handler)


def answering(status: int, **reply: object) -> httpx.MockTransport:
    return httpx.MockTransport(lambda _: httpx.Response(status, **reply))  # type: ignore[arg-type]


async def test_sends_the_key_as_a_bearer_token_and_none_when_there_is_none() -> None:
    seen: list[str | None] = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request.headers.get("authorization"))
        return httpx.Response(200, json={"workspaces": []})

    with_key = bridge(httpx.MockTransport(handle))
    assert await with_key.call("GET", "/workspaces") == {"workspaces": []}
    await bridge(httpx.MockTransport(handle), key="").call("GET", "/workspaces")
    assert seen == ["Bearer k", None]


async def test_sends_the_method_the_path_and_the_json_body() -> None:
    seen: list[tuple[str, str, bytes]] = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append((request.method, request.url.path, request.content))
        return httpx.Response(200, json=None)

    found = bridge(httpx.MockTransport(handle))
    await found.call("DELETE", "/workspace/home/thread/a/delete-edited-chats", {"startingId": 3})
    await found.call("GET", "/scheduled-jobs")
    assert seen == [
        ("DELETE", "/workspace/home/thread/a/delete-edited-chats", b'{"startingId":3}'),
        ("GET", "/scheduled-jobs", b""),
    ]


async def test_a_401_is_the_key_refused_in_the_bridges_words() -> None:
    refused = answering(401, json={"error": "send a developer API key AnythingLLM accepts"})
    with pytest.raises(BridgeError, match=r"^401: the bridge refused the developer key .*accepts$"):
        await bridge(refused).call("GET", "/scheduled-jobs")


async def test_a_404_is_not_found_in_the_servers_words_or_ours() -> None:
    said = answering(404, json={"job": None, "error": "Job not found"})
    with pytest.raises(BridgeError, match=r"^Job not found$"):
        await bridge(said).call("GET", "/scheduled-jobs/9")
    # The bridge passes AnythingLLM's plain-text 404 on as a JSON null.
    with pytest.raises(BridgeError, match="no such workspace, chat or job"):
        await bridge(answering(404, json=None)).call("GET", "/workspace/x/threads")


async def test_any_other_error_keeps_the_reason_without_the_json_around_it() -> None:
    with pytest.raises(BridgeError, match=r"^400: Invalid cron expression$"):
        await bridge(answering(400, json={"job": None, "error": "Invalid cron expression"})).call(
            "POST", "/scheduled-jobs/new", {}
        )
    with pytest.raises(BridgeError, match=r"^403: the bridge doesn't pass GET /x$"):
        await bridge(answering(403, json={"error": "the bridge doesn't pass GET /x"})).call(
            "GET", "/x"
        )
    with pytest.raises(BridgeError, match=r"^502: no reason given$"):
        await bridge(answering(502)).call("GET", "/x")


async def test_a_bare_ok_or_null_is_none() -> None:
    assert await bridge(answering(200, content=b"OK")).call("DELETE", "/x") is None
    assert await bridge(answering(200, json=None)).call("DELETE", "/x") is None


async def test_an_unreachable_bridge_is_said_so() -> None:
    def refuse(_: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")

    with pytest.raises(BridgeError, match="unreachable"):
        await bridge(httpx.MockTransport(refuse)).call("GET", "/workspaces")


@pytest.mark.parametrize("value", ["home", "a-b_C9", "0b1c-4d", "x" * 100])
def test_a_slug_is_one_path_segment(value: str) -> None:
    assert slug(value, "chat") == value


@pytest.mark.parametrize("value", ["", ".", "..", "a/b", "a b", "a?b", "a\n", "é", "x" * 101])
def test_anything_else_is_refused_by_name(value: str) -> None:
    with pytest.raises(BridgeError, match="workspace must be a slug"):
        slug(value, "workspace")


def test_bounded_text_is_stripped_and_one_to_a_limit_long() -> None:
    assert bounded("  Plan  ", "a chat name", 10) == "Plan"
    for bad in ("", "   ", "x" * 11):
        with pytest.raises(BridgeError, match="a chat name is 1 to 10 characters"):
            bounded(bad, "a chat name", 10)
