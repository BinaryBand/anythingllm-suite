"""control_mcp.chats: what the chat tools do. A chat is one of AnythingLLM's threads, named by its
slug inside a workspace's slug. Each use case is a few calls to the bridge, which
passes the routes BRIDGE_ALLOW lists; a route it doesn't list is the bridge's 403, in its
words. A change that loses something (clear, delete) is shown first and made only with `apply`,
and is read back afterwards, since AnythingLLM answers a delete with a bare OK."""

from __future__ import annotations

from dataclasses import dataclass

from control_mcp.bridge import Bridge, BridgeError, Json, bounded, items, obj, slug, text

CHAT_NAME_MAX = 100
SHOWN = 600  # characters of a message in a history
HISTORY = 10  # exchanges a history shows unless it is asked for more
HISTORY_MAX = 50


@dataclass(frozen=True)
class Exchange:
    """A question and its answer, which AnythingLLM numbers together as one `chatId`."""

    chat_id: int
    question: str
    answer: str


def exchanges_of(history: Json) -> list[Exchange]:
    """The exchanges in a thread's `history`, oldest first: it lists a user message and an
    assistant message for each, both with the exchange's `chatId`."""
    found: dict[int, dict[str, str]] = {}
    for entry in map(obj, items(history)):
        chat_id = entry.get("chatId")
        if isinstance(chat_id, int) and not isinstance(chat_id, bool):
            found.setdefault(chat_id, {})[text(entry.get("role"))] = text(entry.get("content"))
    return [Exchange(i, m.get("user", ""), m.get("assistant", "")) for i, m in found.items()]


def clipped(message: str) -> str:
    return message if len(message) <= SHOWN else message[:SHOWN] + "... (cut)"


class Chats:
    def __init__(self, bridge: Bridge) -> None:
        self.bridge = bridge

    async def workspaces(self) -> dict[str, Json]:
        reply = obj(await self.bridge.call("GET", "/workspaces"))
        return {
            "workspaces": [
                {"workspace": text(w.get("slug")), "name": text(w.get("name"))}
                for w in map(obj, items(reply.get("workspaces")))
            ]
        }

    async def listing(self, workspace: str) -> dict[str, Json]:
        return {
            "workspace": workspace,
            "chats": [
                {
                    "chat": text(t.get("slug")),
                    "name": text(t.get("name")),
                    "updated": t.get("lastUpdatedAt"),
                }
                for t in await self._threads(workspace)
            ],
        }

    async def history(self, workspace: str, chat: str, last: int) -> dict[str, Json]:
        if not 1 <= last <= HISTORY_MAX:
            raise BridgeError(f"last is from 1 to {HISTORY_MAX}; got {last}")
        shown, found = await self._summary(workspace, chat)
        return {
            **shown,
            "shown": [
                {
                    "chatId": e.chat_id,
                    "question": clipped(e.question),
                    "answer": clipped(e.answer),
                }
                for e in found[-last:]
            ],
        }

    async def new(self, workspace: str) -> dict[str, Json]:
        reply = obj(
            await self.bridge.call("POST", f"{self._base(workspace)}/thread/new")
        )
        thread = obj(reply.get("thread"))
        if not thread:
            raise BridgeError(text(reply.get("message")) or "no chat was made")
        return {"chat": text(thread.get("slug")), "name": text(thread.get("name"))}

    async def rename(self, workspace: str, chat: str, name: str) -> dict[str, Json]:
        name = bounded(name, "a chat's name", CHAT_NAME_MAX)
        await self._thread(workspace, chat)
        path = f"{self._path(workspace, chat)}/update"
        reply = obj(await self.bridge.call("POST", path, {"name": name}))
        thread = obj(reply.get("thread"))
        if text(thread.get("name")) != name:
            raise BridgeError(text(reply.get("message")) or "the chat was not renamed")
        return {"chat": chat, "name": name}

    async def clear(self, workspace: str, chat: str, *, apply: bool) -> dict[str, Json]:
        """Removes every exchange and keeps the chat and its name."""
        shown, found = await self._summary(workspace, chat)
        if not found:
            return {**shown, "applied": False, "note": "the chat is already empty"}
        if not apply:
            return {**shown, "applied": False, "would": "remove every exchange, keep the chat"}
        await self.bridge.call(
            "DELETE", f"{self._path(workspace, chat)}/delete-edited-chats",
            {"startingId": found[0].chat_id},
        )
        left = await self._history(workspace, chat)
        if left:
            raise BridgeError(f"{len(left)} of {len(found)} exchanges are still there")
        return {**shown, "applied": True, "removed": len(found)}

    async def delete(self, workspace: str, chat: str, *, apply: bool) -> dict[str, Json]:
        """Removes the chat and its exchanges."""
        shown, _ = await self._summary(workspace, chat)
        if not apply:
            return {**shown, "applied": False, "would": "delete the chat and its exchanges"}
        await self.bridge.call("DELETE", self._path(workspace, chat))
        if any(text(t.get("slug")) == chat for t in await self._threads(workspace)):
            raise BridgeError("the chat is still there")
        return {**shown, "applied": True, "deleted": True}

    def _base(self, workspace: str) -> str:
        return f"/workspace/{slug(workspace, 'workspace')}"

    def _path(self, workspace: str, chat: str) -> str:
        return f"{self._base(workspace)}/thread/{slug(chat, 'chat')}"

    async def _threads(self, workspace: str) -> list[dict[str, Json]]:
        path = f"{self._base(workspace)}/threads"
        return [obj(t) for t in items(obj(await self.bridge.call("GET", path)).get("threads"))]

    async def _summary(self, workspace: str, chat: str) -> tuple[dict[str, Json], list[Exchange]]:
        """What a change is shown as, and the chat's exchanges, oldest first."""
        thread = await self._thread(workspace, chat)
        found = await self._history(workspace, chat)
        name = text(thread.get("name"))
        return {"chat": chat, "name": name, "exchanges": len(found)}, found

    async def _thread(self, workspace: str, chat: str) -> dict[str, Json]:
        slug(chat, "chat")  # before any call: a bad slug never reaches the bridge
        for thread in await self._threads(workspace):
            if text(thread.get("slug")) == chat:
                return thread
        raise BridgeError(f"workspace {workspace!r} has no chat {chat!r}")

    async def _history(self, workspace: str, chat: str) -> list[Exchange]:
        reply = await self.bridge.call("GET", f"{self._path(workspace, chat)}/chats")
        return exchanges_of(obj(reply).get("history"))
