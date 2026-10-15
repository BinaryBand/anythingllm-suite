import pytest
from fakes import FakeAnythingLlm

from control_mcp.bridge import BridgeError
from control_mcp.chats import SHOWN, Chats, exchanges_of


def chats(fake: FakeAnythingLlm) -> Chats:
    return Chats(fake.bridge())


async def test_the_workspaces_and_their_chats_are_listed_by_slug() -> None:
    found = chats(FakeAnythingLlm())
    assert (await found.workspaces())["workspaces"] == [
        {"workspace": "home", "name": "Home"},
        {"workspace": "work", "name": "Work"},
    ]
    listing = await found.listing("home")
    assert [(c["chat"], c["name"]) for c in listing["chats"]] == [  # type: ignore[index]
        ("aaa-1", "Trip planning"),
        ("bbb-2", "Thread"),
    ]


def test_history_pairs_a_question_with_its_answer_by_chat_id() -> None:
    history = [
        {"role": "user", "content": "q1", "chatId": 5},
        {"role": "assistant", "content": "a1", "chatId": 5},
        {"role": "user", "content": "q2", "chatId": 6},
        {"role": "user", "content": "no id"},
        "junk",
    ]
    assert [(e.chat_id, e.question, e.answer) for e in exchanges_of(history)] == [
        (5, "q1", "a1"),
        (6, "q2", ""),
    ]
    assert exchanges_of({"not": "a list"}) == []


async def test_a_history_shows_the_last_exchanges_cut_short() -> None:
    fake = FakeAnythingLlm()
    fake.chats["aaa-1"].append((12, "Long?", "x" * 2000))
    shown = await chats(fake).history("home", "aaa-1", 2)
    assert shown["exchanges"] == 3
    assert [e["chatId"] for e in shown["shown"]] == [11, 12]  # type: ignore[index]
    assert len(shown["shown"][1]["answer"]) < SHOWN + 20  # type: ignore[index]
    with pytest.raises(BridgeError, match="last is from 1 to 50"):
        await chats(fake).history("home", "aaa-1", 0)


async def test_a_new_chat_is_named_thread_until_renamed() -> None:
    fake = FakeAnythingLlm()
    made = await chats(fake).new("work")
    assert made["name"] == "Thread"
    renamed = await chats(fake).rename("work", str(made["chat"]), "  Quarterly plan ")
    assert renamed == {"chat": made["chat"], "name": "Quarterly plan"}
    assert fake.threads["work"] == {made["chat"]: "Quarterly plan"}


async def test_a_rename_needs_a_name_and_a_chat_that_exists() -> None:
    fake = FakeAnythingLlm()
    for bad in ("", "   ", "x" * 101):
        with pytest.raises(BridgeError, match="a chat's name is 1 to 100 characters"):
            await chats(fake).rename("home", "aaa-1", bad)
    with pytest.raises(BridgeError, match="has no chat 'nope'"):
        await chats(fake).rename("home", "nope", "Name")
    with pytest.raises(BridgeError, match="no such workspace"):
        await chats(fake).rename("nowhere", "aaa-1", "Name")
    assert not fake.changes()


async def test_clear_is_shown_first_and_changes_nothing() -> None:
    fake = FakeAnythingLlm()
    shown = await chats(fake).clear("home", "aaa-1", apply=False)
    assert shown["applied"] is False
    assert (shown["name"], shown["exchanges"]) == ("Trip planning", 2)
    assert len(fake.chats["aaa-1"]) == 2
    assert not fake.changes()


async def test_clear_removes_every_exchange_and_keeps_the_chat() -> None:
    fake = FakeAnythingLlm()
    done = await chats(fake).clear("home", "aaa-1", apply=True)
    assert (done["applied"], done["removed"]) == (True, 2)
    assert fake.chats["aaa-1"] == []
    assert fake.threads["home"]["aaa-1"] == "Trip planning"
    [delete] = [call for call in fake.calls if call[0] != "GET"]
    assert delete == (
        "DELETE", "/workspace/home/thread/aaa-1/delete-edited-chats", {"startingId": 10},
    )


async def test_clearing_an_empty_chat_asks_for_nothing() -> None:
    fake = FakeAnythingLlm()
    assert (await chats(fake).clear("home", "bbb-2", apply=True))["applied"] is False
    assert not fake.changes()


async def test_clear_reads_back_and_does_not_claim_a_clear_that_did_nothing() -> None:
    fake = FakeAnythingLlm()
    fake.ignores_deletes = True
    with pytest.raises(BridgeError, match="2 of 2 exchanges are still there"):
        await chats(fake).clear("home", "aaa-1", apply=True)


async def test_delete_is_shown_first_then_removes_the_chat_and_reads_it_back() -> None:
    fake = FakeAnythingLlm()
    shown = await chats(fake).delete("home", "aaa-1", apply=False)
    assert (shown["applied"], shown["exchanges"]) == (False, 2)
    assert "aaa-1" in fake.threads["home"]
    done = await chats(fake).delete("home", "aaa-1", apply=True)
    assert done["deleted"] is True
    assert "aaa-1" not in fake.threads["home"]
    assert fake.changes() == [("DELETE", "/workspace/home/thread/aaa-1")]


async def test_delete_that_changed_nothing_is_an_error() -> None:
    fake = FakeAnythingLlm()
    fake.ignores_deletes = True
    with pytest.raises(BridgeError, match="still there"):
        await chats(fake).delete("home", "aaa-1", apply=True)


@pytest.mark.parametrize("bad", ["../x", "a/b", "", "a b"])
async def test_a_slug_that_is_not_one_never_reaches_the_bridge(bad: str) -> None:
    fake = FakeAnythingLlm()
    for call in (
        chats(fake).listing(bad),
        chats(fake).history(bad, "aaa-1", 5),
        chats(fake).history("home", bad, 5),
        chats(fake).delete("home", bad, apply=True),
        chats(fake).new(bad),
    ):
        with pytest.raises(BridgeError, match="must be a slug"):
            await call
    assert not fake.calls
