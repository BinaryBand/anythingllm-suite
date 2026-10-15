import json

import pytest
from fakes import FakeAnythingLlm

from control_mcp.bridge import BridgeError
from control_mcp.jobs import JobEdit, Jobs, JobSpec


def jobs(fake: FakeAnythingLlm) -> Jobs:
    return Jobs(fake.bridge())


NEW = JobSpec("Weekly digest", "Summarise my week.", "0 7 * * 1", ["web-scraping"])


async def test_the_listing_reads_tools_from_their_json_text_and_says_utc() -> None:
    listing = await jobs(FakeAnythingLlm()).listing()
    assert listing["timezone"] == "UTC"
    [job] = listing["jobs"]  # type: ignore[misc]
    assert (job["id"], job["name"], job["schedule"]) == (1, "Morning news", "30 4 * * *")
    assert job["tools"] == ["web-browsing"]
    assert job["enabled"] is True


async def test_add_is_shown_first_and_changes_nothing() -> None:
    fake = FakeAnythingLlm()
    shown = await jobs(fake).add(NEW, apply=False)
    assert shown["applied"] is False
    assert shown["would_add"]["schedule"] == "0 7 * * 1"  # type: ignore[index]
    assert len(fake.jobs) == 1
    assert not fake.changes()


async def test_add_makes_the_job_and_gives_it_back() -> None:
    fake = FakeAnythingLlm()
    done = await jobs(fake).add(NEW, apply=True)
    assert done["applied"] is True
    assert done["job"]["id"] == 2  # type: ignore[index]
    body = fake.calls[-1][2]
    assert body == {"name": "Weekly digest", "prompt": "Summarise my week.",
                    "tools": ["web-scraping"], "schedule": "0 7 * * 1"}
    assert json.loads(str(fake.jobs[2]["tools"])) == ["web-scraping"]


async def test_a_retried_add_does_not_make_a_second_job() -> None:
    fake = FakeAnythingLlm()
    await jobs(fake).add(NEW, apply=True)
    with pytest.raises(BridgeError, match=r"identical job already exists \(id 2\)"):
        await jobs(fake).add(NEW, apply=True)
    assert len(fake.jobs) == 2


async def test_the_preview_names_a_job_with_the_same_name() -> None:
    fake = FakeAnythingLlm()
    shown = await jobs(fake).add(JobSpec("morning NEWS", "Other.", "0 8 * * *"), apply=False)
    assert shown["same_name"] == [1]


@pytest.mark.parametrize(
    "spec",
    [
        JobSpec("", "p", "0 7 * * *"),
        JobSpec("n", " ", "0 7 * * *"),
        JobSpec("n", "p", "every day"),
        JobSpec("n", "p", "0 7 * *"),
        JobSpec("n", "p", "0 7 * * * *"),
        JobSpec("n", "p", "0 7 * * *", ["not a tool id"]),
        JobSpec("x" * 101, "p", "0 7 * * *"),
    ],
)
async def test_a_bad_job_is_refused_before_the_bridge(spec: JobSpec) -> None:
    fake = FakeAnythingLlm()
    with pytest.raises(BridgeError, match=r"cron expression in UTC|tools are up to|1 to \d+ char"):
        await jobs(fake).add(spec, apply=True)
    assert not fake.calls


async def test_anythingllms_own_refusal_is_said() -> None:
    fake = FakeAnythingLlm()
    with pytest.raises(BridgeError, match="Invalid cron expression"):
        await jobs(fake).add(JobSpec("n", "p", "99 7 * * *"), apply=True)  # five fields
    assert len(fake.jobs) == 1


async def test_update_shows_each_change_from_and_to() -> None:
    fake = FakeAnythingLlm()
    shown = await jobs(fake).update(1, JobEdit(schedule="0 6 * * *", enabled=False), apply=False)
    assert shown["changes"] == {
        "schedule": {"from": "30 4 * * *", "to": "0 6 * * *"},
        "enabled": {"from": True, "to": False},
    }
    assert fake.jobs[1]["schedule"] == "30 4 * * *"
    assert not fake.changes()


async def test_update_changes_only_the_fields_given() -> None:
    fake = FakeAnythingLlm()
    done = await jobs(fake).update(1, JobEdit(enabled=False), apply=True)
    assert done["job"]["enabled"] is False  # type: ignore[index]
    assert fake.calls[-1] == ("PUT", "/scheduled-jobs/1", {"enabled": False})
    assert fake.jobs[1]["name"] == "Morning news"


async def test_update_can_clear_the_tools() -> None:
    fake = FakeAnythingLlm()
    await jobs(fake).update(1, JobEdit(tools=[]), apply=True)
    assert fake.calls[-1][2] == {"tools": []}


async def test_an_update_that_changes_nothing_says_so_and_sends_nothing() -> None:
    fake = FakeAnythingLlm()
    done = await jobs(fake).update(1, JobEdit(name="Morning news"), apply=True)
    assert done["applied"] is False
    assert not fake.changes()


async def test_an_update_needs_something_to_change_and_a_job_that_exists() -> None:
    fake = FakeAnythingLlm()
    with pytest.raises(BridgeError, match="say what to change"):
        await jobs(fake).update(1, JobEdit(), apply=True)
    with pytest.raises(BridgeError, match="Job not found"):
        await jobs(fake).update(9, JobEdit(enabled=False), apply=True)
    with pytest.raises(BridgeError, match="whole number from 1"):
        await jobs(fake).update(0, JobEdit(enabled=False), apply=True)
    assert not fake.changes()


async def test_a_bad_new_schedule_in_an_update_is_refused_before_the_bridge() -> None:
    fake = FakeAnythingLlm()
    with pytest.raises(BridgeError, match="cron"):
        await jobs(fake).update(1, JobEdit(schedule="daily"), apply=True)
    assert not fake.calls


async def test_delete_is_shown_first_then_removes_the_job() -> None:
    fake = FakeAnythingLlm()
    shown = await jobs(fake).delete(1, apply=False)
    assert shown["would_delete"]["name"] == "Morning news"  # type: ignore[index]
    assert 1 in fake.jobs
    done = await jobs(fake).delete(1, apply=True)
    assert (done["deleted"], done["name"]) == (1, "Morning news")
    assert fake.jobs == {}


async def test_deleting_a_job_that_is_gone_is_not_found() -> None:
    fake = FakeAnythingLlm()
    with pytest.raises(BridgeError, match="Job not found"):
        await jobs(fake).delete(7, apply=True)
