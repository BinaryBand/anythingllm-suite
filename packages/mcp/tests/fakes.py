"""tests.fakes: AnythingLLM's internal API in memory, answering as the bridge passes it on (its
status and JSON, or null for the plain text some routes send), shaped by reading AnythingLLM
1.16.2 (contract/endpoints.md). The unit tests reach it through the real Bridge client over
httpx's mock transport; the stdio test puts it behind HTTP."""

from __future__ import annotations

import json
import re
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import httpx

from control_mcp.bridge import Bridge, Json, items, obj, text

type Reply = tuple[int, Json]
NOT_FOUND: Reply = (404, None)


class FakeAnythingLlm:
    def __init__(self) -> None:
        self.workspaces = {"home": "Home", "work": "Work"}
        # a workspace's chats, oldest first: slug -> name
        self.threads: dict[str, dict[str, str]] = {
            "home": {"aaa-1": "Trip planning", "bbb-2": "Thread"},
            "work": {},
        }
        # a thread's exchanges: slug -> [(chatId, question, answer)]
        self.chats: dict[str, list[tuple[int, str, str]]] = {
            "aaa-1": [(10, "Where to?", "Lisbon."), (11, "When?", "In May.")],
            "bbb-2": [],
        }
        self.jobs: dict[int, dict[str, Json]] = {}
        self.calls: list[tuple[str, str, Json]] = []
        self.ignores_deletes = False  # a delete that answers OK and does nothing
        self._chat_id = 100
        self._job_id = 1
        self.add_job("Morning news", "Summarise the news.", "30 4 * * *", ["web-browsing"])

    def add_job(self, name: str, prompt: str, schedule: str, tools: list[str] | None) -> int:
        job_id, self._job_id = self._job_id, self._job_id + 1
        self.jobs[job_id] = {
            "id": job_id,
            "name": name,
            "prompt": prompt,
            "tools": json.dumps(tools) if tools else None,
            "schedule": schedule,
            "enabled": True,
            "lastRunAt": None,
            "nextRunAt": "2026-10-16T04:30:00.000Z",
            "latestRun": None,
        }
        return job_id

    def answer(self, method: str, path: str, body: Json = None) -> Reply:
        self.calls.append((method, path, body))
        parts = path.strip("/").split("/")
        if parts[0] == "workspaces" and method == "GET":
            return 200, {"workspaces": [{"slug": s, "name": n} for s, n in self.workspaces.items()]}
        if parts[0] == "workspace" and len(parts) >= 3:
            return self._thread_route(method, parts[1], parts[2:], obj(body))
        if parts[0] == "scheduled-jobs":
            return self._job_route(method, parts[1:], obj(body))
        return 403, {"error": f"the bridge doesn't pass {method} /{path.strip('/')}"}

    def _thread_route(self, method: str, workspace: str, rest: list[str], body: dict) -> Reply:
        if workspace not in self.workspaces:
            return NOT_FOUND
        threads = self.threads[workspace]
        if rest == ["threads"] and method == "GET":
            return 200, {
                "threads": [
                    {"id": i, "name": n, "slug": s, "lastUpdatedAt": "2026-10-15T08:00:00.000Z"}
                    for i, (s, n) in enumerate(threads.items(), 1)
                ],
                "defaultThreadChatCount": 0,
            }
        if rest == ["thread", "new"] and method == "POST":
            slug = f"new-{len(threads) + 1}"
            threads[slug] = "Thread"
            self.chats[slug] = []
            return 200, {"thread": {"slug": slug, "name": "Thread"}, "message": None}
        if len(rest) < 2 or rest[0] != "thread" or rest[1] not in threads:
            return NOT_FOUND
        slug, action = rest[1], rest[2:]
        if action == ["update"] and method == "POST":
            if "name" not in body:
                return 200, {"thread": {"slug": slug}, "message": "No valid fields to update!"}
            threads[slug] = text(body["name"])
            return 200, {"thread": {"slug": slug, "name": threads[slug]}, "message": None}
        if action == ["chats"] and method == "GET":
            history = [
                {"role": role, "content": content, "chatId": chat_id}
                for chat_id, question, answer in self.chats[slug]
                for role, content in (("user", question), ("assistant", answer))
            ]
            return 200, {"history": history}
        if action == ["delete-edited-chats"] and method == "DELETE":
            start = body.get("startingId")
            if not self.ignores_deletes and isinstance(start, int):
                self.chats[slug] = [c for c in self.chats[slug] if c[0] < start]
            return 200, None  # AnythingLLM sends the text OK
        if not action and method == "DELETE":
            if not self.ignores_deletes:
                del threads[slug]
                del self.chats[slug]
            return 200, None
        return 403, {"error": "the bridge doesn't pass this"}

    def _job_route(self, method: str, rest: list[str], body: dict) -> Reply:
        if not rest and method == "GET":
            return 200, {"jobs": list(self.jobs.values())}
        if rest == ["new"] and method == "POST":
            return self._create(body)
        if len(rest) != 1 or not rest[0].isdigit():
            return 403, {"error": "the bridge doesn't pass this"}
        if method == "DELETE":
            return 200, {"success": self.jobs.pop(int(rest[0]), None) is not None}
        job = self.jobs.get(int(rest[0]))
        if job is None:
            return 404, {"job": None, "error": "Job not found"}
        if method == "GET":
            return 200, {"job": job}
        if method == "PUT":
            if "schedule" in body and not valid_cron(text(body["schedule"])):
                return 400, {"job": None, "error": "Invalid cron expression"}
            fields = {"name", "prompt", "schedule", "enabled"}
            job.update({k: v for k, v in body.items() if k in fields})
            if "tools" in body:
                job["tools"] = json.dumps(body["tools"])
            return 200, {"job": job, "error": None}
        return 403, {"error": "the bridge doesn't pass this"}

    def _create(self, body: dict) -> Reply:
        if not valid_cron(text(body.get("schedule"))):
            return 400, {"job": None, "error": "Invalid cron expression"}
        tools = [text(t) for t in items(body.get("tools"))]
        name, prompt = text(body.get("name")), text(body.get("prompt"))
        job_id = self.add_job(name, prompt, text(body["schedule"]), tools)
        return 201, {"job": self.jobs[job_id], "error": None}

    def changes(self) -> list[tuple[str, str]]:
        """The calls so far that were not reads."""
        return [(m, p) for m, p, _ in self.calls if m != "GET"]

    def transport(self) -> httpx.MockTransport:
        def handle(request: httpx.Request) -> httpx.Response:
            body = json.loads(request.content) if request.content else None
            status, found = self.answer(request.method, request.url.path, body)
            return httpx.Response(status, json=found)

        return httpx.MockTransport(handle)

    def bridge(self) -> Bridge:
        return Bridge("http://bridge", "k", transport=self.transport())


def serve(fake: FakeAnythingLlm, keys: list[str]) -> HTTPServer:
    """`fake` behind HTTP on a free port, in a thread, keeping each call's Authorization header
    in `keys`; the caller shuts it down."""

    class Handler(BaseHTTPRequestHandler):
        def serve(self) -> None:
            keys.append(self.headers.get("Authorization", ""))
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length)) if length else None
            status, found = fake.answer(self.command, self.path, body)
            raw = json.dumps(found).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        do_GET = do_POST = do_PUT = do_DELETE = serve  # noqa: N815

        def log_message(self, *_args: object) -> None:
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def valid_cron(schedule: str) -> bool:
    """Five fields, and a minute past 59 is wrong: enough for a refusal in AnythingLLM's words."""
    fields = schedule.split()
    if len(fields) != 5 or not all(re.fullmatch(r"[0-9*/,?#A-Za-z-]+", f) for f in fields):
        return False
    return not (fields[0].isdigit() and int(fields[0]) > 59)
