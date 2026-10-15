"""control_mcp.jobs: what the schedule tools do. A scheduled job is AnythingLLM's own: a name,
a prompt the agent runs, optional tools, and a cron schedule in UTC. Each use case is a few calls
to the bridge, which passes `/scheduled-jobs` when BRIDGE_ALLOW lists it. A change is
shown first and made only with `apply`. AnythingLLM takes no idempotency key and allows two jobs
alike, so an add that finds an identical job refuses, which makes a retried add safe."""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from dataclasses import dataclass

from control_mcp.bridge import Bridge, BridgeError, Json, bounded, items, obj, text

JOB_NAME_MAX = 100
MAX_PROMPT = 4000
MAX_TOOLS = 50
CRON_FIELDS = 5
CRON_FIELD = re.compile(r"[0-9A-Za-z*/,?#-]+")
TOOL_ID = re.compile(r"[A-Za-z0-9_.#-]{1,120}")
UTC = "the schedule is a cron expression in UTC: minute hour day-of-month month day-of-week"


@dataclass(frozen=True)
class JobSpec:
    """A job to add."""

    name: str
    prompt: str
    schedule: str
    tools: list[str] | None = None


@dataclass(frozen=True)
class JobEdit:
    """The fields of a job to change; None leaves one as it is."""

    name: str | None = None
    prompt: str | None = None
    schedule: str | None = None
    tools: list[str] | None = None
    enabled: bool | None = None

    def fields(self) -> dict[str, Json]:
        found: dict[str, Json] = {
            "name": self.name,
            "prompt": self.prompt,
            "schedule": self.schedule,
            "tools": None if self.tools is None else [*self.tools],
            "enabled": self.enabled,
        }
        return {k: v for k, v in found.items() if v is not None}


def job_id(value: int) -> int:
    """`value` when it can be a scheduled job's id."""
    if isinstance(value, bool) or value < 1:
        raise BridgeError(f"a job is a whole number from 1; got {value!r}")
    return value


def checked_name(name: str) -> str:
    return bounded(name, "a job's name", JOB_NAME_MAX)


def checked_prompt(prompt: str) -> str:
    return bounded(prompt, "a job's prompt", MAX_PROMPT)


def optional(check: Callable[[str], str], value: str | None) -> str | None:
    """`check`ed `value`, or None where the field is left as it is."""
    return None if value is None else check(value)


def checked_schedule(schedule: str) -> str:
    """Five cron fields. Whether they mean anything is AnythingLLM's to say, in its words."""
    fields = schedule.split()
    if len(fields) != CRON_FIELDS or not all(CRON_FIELD.fullmatch(f) for f in fields):
        raise BridgeError(f"{UTC}; got {schedule[:60]!r}")
    return " ".join(fields)


def checked_tools(tools: list[str] | None) -> list[str] | None:
    if tools is not None and (
        len(tools) > MAX_TOOLS or not all(TOOL_ID.fullmatch(t) for t in tools)
    ):
        raise BridgeError(f"tools are up to {MAX_TOOLS} ids such as web-scraping")
    return tools


def tools_of(value: Json) -> list[Json]:
    """A job's tools: AnythingLLM keeps them as JSON text, or null."""
    try:
        found = json.loads(value) if isinstance(value, str) else value
    except ValueError:
        return []
    return items(found)


def shown(job: dict[str, Json]) -> dict[str, Json]:
    """A job as the agent reads it. The times are AnythingLLM's own, UTC."""
    return {
        "id": job.get("id"),
        "name": text(job.get("name")),
        "prompt": text(job.get("prompt")),
        "schedule": text(job.get("schedule")),
        "enabled": bool(job.get("enabled")),
        "tools": tools_of(job.get("tools")),
        "lastRunAt": job.get("lastRunAt"),
        "nextRunAt": job.get("nextRunAt"),
        "lastStatus": obj(job.get("latestRun")).get("status"),
    }


def made(reply: dict[str, Json]) -> dict[str, Json]:
    """The job in AnythingLLM's reply, or its reason for sending none."""
    job = obj(reply.get("job"))
    if not job:
        raise BridgeError(text(reply.get("error")) or "AnythingLLM sent no job")
    return job


class Jobs:
    def __init__(self, bridge: Bridge) -> None:
        self.bridge = bridge

    async def listing(self) -> dict[str, Json]:
        return {"timezone": "UTC", "jobs": [shown(j) for j in await self._all()]}

    async def add(self, spec: JobSpec, *, apply: bool) -> dict[str, Json]:
        spec = JobSpec(
            checked_name(spec.name),
            checked_prompt(spec.prompt),
            checked_schedule(spec.schedule),
            checked_tools(spec.tools),
        )
        wanted: dict[str, Json] = {
            "name": spec.name,
            "prompt": spec.prompt,
            "schedule": spec.schedule,
            "tools": spec.tools or [],
        }
        existing = [shown(j) for j in await self._all()]
        same = next((j["id"] for j in existing if all(j[k] == v for k, v in wanted.items())), None)
        if same is not None:
            raise BridgeError(f"an identical job already exists (id {same})")
        if not apply:
            alike = [j["id"] for j in existing if text(j["name"]).lower() == spec.name.lower()]
            return {"applied": False, "would_add": wanted, "note": UTC, "same_name": alike}
        reply = obj(
            await self.bridge.call(
                "POST",
                "/scheduled-jobs/new",
                {"name": spec.name, "prompt": spec.prompt, "tools": spec.tools,
                 "schedule": spec.schedule},
            )
        )
        return {"applied": True, "job": shown(made(reply))}

    async def update(self, job: int, edit: JobEdit, *, apply: bool) -> dict[str, Json]:
        edit = JobEdit(
            optional(checked_name, edit.name),
            optional(checked_prompt, edit.prompt),
            optional(checked_schedule, edit.schedule),
            checked_tools(edit.tools),
            edit.enabled,
        )
        changes = edit.fields()
        if not changes:
            raise BridgeError("say what to change: name, prompt, schedule, tools or enabled")
        current = shown(await self._one(job))
        differing = {
            k: {"from": current[k], "to": v} for k, v in changes.items() if current[k] != v
        }
        if not differing:
            return {"applied": False, "job": current["id"], "note": "the job already is so"}
        if not apply:
            return {"applied": False, "job": current["id"], "name": current["name"],
                    "changes": differing, "note": UTC}
        reply = obj(await self.bridge.call("PUT", self._path(job), changes))
        return {"applied": True, "job": shown(made(reply))}

    async def delete(self, job: int, *, apply: bool) -> dict[str, Json]:
        current = shown(await self._one(job))
        if not apply:
            return {"applied": False, "would_delete": current}
        reply = obj(await self.bridge.call("DELETE", self._path(job)))
        if reply.get("success") is not True:
            raise BridgeError(f"AnythingLLM has no job {job}")
        return {"applied": True, "deleted": current["id"], "name": current["name"]}

    def _path(self, job: int) -> str:
        return f"/scheduled-jobs/{job_id(job)}"

    async def _all(self) -> list[dict[str, Json]]:
        reply = obj(await self.bridge.call("GET", "/scheduled-jobs"))
        return [obj(j) for j in items(reply.get("jobs"))]

    async def _one(self, job: int) -> dict[str, Json]:
        reply = obj(await self.bridge.call("GET", self._path(job)))
        return made(reply)
