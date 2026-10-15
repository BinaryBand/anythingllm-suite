"""control_mcp.bridge: the bridge to AnythingLLM's internal API, over HTTP with the developer key
as a bearer token. AnythingLLM's status and JSON come through the bridge as they are, so this
reads them: a 404 is a missing thing, any other error is kept with the reason AnythingLLM or the
bridge gave. Every error reaches the agent as its message, so there is one error type.

Also what a tool reads a reply with, which never raises (a reply of another shape reads as
empty), and the checks on what a tool puts into a path."""

from __future__ import annotations

import re

import httpx

type Json = bool | int | float | str | list[Json] | dict[str, Json] | None

TIMEOUT = 30.0
SAID_MAX = 300
SLUG = re.compile(r"[A-Za-z0-9_-]{1,100}")


class BridgeError(Exception):
    """What went wrong between the agent and AnythingLLM, in words the agent can use."""


def obj(value: Json) -> dict[str, Json]:
    """`value` when it is an object, else an empty one."""
    return value if isinstance(value, dict) else {}


def items(value: Json) -> list[Json]:
    """`value` when it is a list, else an empty one."""
    return value if isinstance(value, list) else []


def text(value: Json) -> str:
    """`value` when it is a string, else an empty one."""
    return value if isinstance(value, str) else ""


def slug(value: str, what: str) -> str:
    """`value` when it is a workspace's or a chat's slug: one path segment of letters, digits,
    `-` and `_`. The bridge refuses a `.`, `..` or empty segment and requotes the rest; this
    refuses the rest early, in words the agent can use."""
    if not SLUG.fullmatch(value):
        raise BridgeError(
            f"{what} must be a slug of letters, digits, - and _ (up to 100); got {value[:40]!r}"
        )
    return value


def bounded(value: str, what: str, maximum: int) -> str:
    """`value` stripped, when it is 1 to `maximum` characters."""
    value = value.strip()
    if not 1 <= len(value) <= maximum:
        raise BridgeError(f"{what} is 1 to {maximum} characters")
    return value


def said(response: httpx.Response) -> str:
    """The reason an error answer gives: its `error`, else its text, kept short; empty when it
    gives none. A bare JSON null is the bridge passing on an answer that was plain text."""
    try:
        body = response.json()
    except ValueError:
        body = response.text.strip()
    reason = text(obj(body).get("error")) or text(body)
    return reason[:SAID_MAX]


def refusal(response: httpx.Response) -> str:
    """What an error answer means to the agent."""
    reason = said(response)
    if response.status_code == httpx.codes.UNAUTHORIZED:
        return f"401: the bridge refused the developer key (ANYTHINGLLM_DEVELOPER_KEY): {reason}"
    if response.status_code == httpx.codes.NOT_FOUND:
        return reason or "AnythingLLM has no such workspace, chat or job"
    return f"{response.status_code}: {reason or 'no reason given'}"


class Bridge:
    def __init__(
        self, url: str, key: str, transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._http = httpx.AsyncClient(
            base_url=url,
            headers={"Authorization": f"Bearer {key}"} if key else {},
            timeout=TIMEOUT,
            transport=transport,
        )

    async def call(self, method: str, path: str, body: Json = None) -> Json:
        """AnythingLLM's JSON for `method` on `path` (under its /api, as the bridge passes it),
        with an optional JSON `body`; None for an answer that is not JSON."""
        try:
            response = await self._http.request(method, path, json=body)
        except httpx.HTTPError as error:
            raise BridgeError(f"the bridge is unreachable: {error!r}") from error
        if response.is_error:
            raise BridgeError(refusal(response))
        try:
            return response.json()
        except ValueError:
            return None
