import json
import subprocess
from dataclasses import replace
from pathlib import Path

import pytest

from control_mcp import install as target
from control_mcp.install import (
    INSIDE,
    NAME,
    SERVERS_FILE,
    SOCK,
    UNIT,
    Machine,
    container_entry,
    native_entry,
    ours,
    parse_env,
    quote,
    service_unit,
    socket_unit,
)

PYTHON = "/checkout/.venv/bin/python"
VERSIONS = Path(__file__).resolve().parents[3] / "contract" / "versions.env"


class Systemctl:
    """A recording stand-in for the machine's commands: systemd answers `running` unless told
    otherwise, and every other call succeeds unless `refuse` names its first word."""

    def __init__(self, state: str = "running", refuse: str = "") -> None:
        self.state, self.refuse, self.calls = state, refuse, []

    def __call__(self, args: list[str]) -> subprocess.CompletedProcess[str]:
        self.calls.append(" ".join(args[2:]))
        if args[2] == "is-system-running":
            return subprocess.CompletedProcess(args, 0, self.state, "")
        return subprocess.CompletedProcess(args, int(args[2] == self.refuse), "", "boom")


@pytest.fixture
def m(tmp_path: Path) -> Machine:
    """A machine whose config, settings and AnythingLLM storage (`tmp_path / "storage"`) are in a
    temporary folder, and whose systemctl is a recording stand-in."""
    (tmp_path / "storage" / "plugins").mkdir(parents=True)
    env = {
        "XDG_CONFIG_HOME": str(tmp_path / "config"),
        "MCP_ENV_DIR": str(tmp_path / "mcp"),
        "BRIDGE_ENV_FILE": str(tmp_path / "bridge.env"),
    }
    return Machine(env, tmp_path, Systemctl(), PYTHON)


def storage(m: Machine) -> Path:
    return m.home / "storage"


def servers(m: Machine) -> dict:
    return json.loads((storage(m) / SERVERS_FILE).read_text())["mcpServers"]


def test_the_units_name_the_socket_and_run_the_python_that_installed_them() -> None:
    socket = Path("/srv/storage/anythingllm-mcp/control.sock")
    text = socket_unit(socket)
    assert "ListenStream=/srv/storage/anythingllm-mcp/control.sock\n" in text
    assert "SocketMode=0600\n" in text
    assert "Accept=yes\n" in text
    service = service_unit(PYTHON, Path("/home/me/.config/anythingllm-mcp/control.env"))
    assert f"ExecStart={PYTHON} -m control_mcp\n" in service
    assert "EnvironmentFile=-/home/me/.config/anythingllm-mcp/control.env\n" in service
    assert "StandardInput=socket\n" in service


@pytest.mark.parametrize(
    ("word", "quoted"),
    [
        ("/usr/bin/python", "/usr/bin/python"),
        ("/my dir/python", '"/my dir/python"'),
        ("/a%b/python", '"/a%%b/python"'),
        ("/a$b", '"/a$$b"'),
        ('/a"b', '"/a\\"b"'),
    ],
)
def test_a_word_of_exec_start_is_quoted_when_systemd_would_split_or_expand_it(
    word: str, quoted: str
) -> None:
    assert quote(word) == quoted


def test_the_container_entry_runs_a_relay_to_the_socket_in_the_containers_storage() -> None:
    entry = container_entry()
    assert entry["command"] == "node"
    assert entry["args"][0] == "-e"
    assert entry["args"][2] == "/app/server/storage/anythingllm-mcp/control.sock"
    assert "createConnection(process.argv[1])" in entry["args"][1]


def test_the_native_entry_is_the_command_with_the_settings_when_there_are_any() -> None:
    assert native_entry(PYTHON, {}) == {"command": PYTHON, "args": ["-m", "control_mcp"]}
    assert native_entry(PYTHON, {"A": "1"})["env"] == {"A": "1"}


def test_an_entry_is_ours_when_it_starts_the_control_server_either_way() -> None:
    assert ours(container_entry())
    assert ours(native_entry(PYTHON, {}))
    assert not ours({"command": "npx", "args": ["some-other-server"]})


def test_env_files_read_quoted_values_and_skip_comments() -> None:
    text = "# a comment\nA=1\nB = 'two words'\n\nC=\"x\"\nnot a pair\n"
    assert parse_env(text) == {"A": "1", "B": "two words", "C": "x"}


def test_install_writes_the_units_and_the_entry_and_starts_the_socket(m: Machine) -> None:
    done = target.install(storage(m), m)
    socket = storage(m) / SOCK
    assert f"ListenStream={socket}" in (m.units / f"{UNIT}.socket").read_text()
    assert f"ExecStart={PYTHON} -m control_mcp" in (m.units / f"{UNIT}@.service").read_text()
    assert servers(m) == {NAME: container_entry()}
    assert m.runner.calls == ["is-system-running", "daemon-reload", f"enable --now {UNIT}.socket"]
    assert any("started" in line for line in done)


def test_a_second_install_changes_nothing_and_other_servers_stay(m: Machine) -> None:
    file = storage(m) / SERVERS_FILE
    file.write_text(json.dumps({"mcpServers": {"mine": {"command": "x"}}, "other": 1}))
    target.install(storage(m), m)
    first = file.read_text()
    done = target.install(storage(m), m)
    assert file.read_text() == first
    assert servers(m) == {"mine": {"command": "x"}, NAME: container_entry()}
    assert json.loads(first)["other"] == 1
    assert all(line.startswith(("unchanged", "started")) for line in done)


def test_a_reinstall_keeps_the_settings_anythingllm_keeps_in_our_entry(m: Machine) -> None:
    target.install(storage(m), m)
    mine = {"suppressedTools": ["chat_delete"], "autoStart": False}
    file = storage(m) / SERVERS_FILE
    config = json.loads(file.read_text())
    config["mcpServers"][NAME]["anythingllm"] = mine
    config["mcpServers"][NAME]["args"][2] = "/old/path/anythingllm-mcp/control.sock"
    file.write_text(json.dumps(config))
    target.install(storage(m), m)
    assert servers(m)[NAME] == {**container_entry(), "anythingllm": mine}


def test_no_start_writes_the_files_and_runs_nothing_but_the_question(m: Machine) -> None:
    target.install(storage(m), m, start=False)
    assert m.runner.calls == ["is-system-running"]
    assert servers(m) == {NAME: container_entry()}


def test_native_writes_the_command_with_the_settings_and_no_units(m: Machine) -> None:
    m.env_file.parent.mkdir()
    m.env_file.write_text("ANYTHINGLLM_DEVELOPER_KEY=k\n")
    target.install(storage(m), m, native=True)
    assert servers(m)[NAME] == native_entry(PYTHON, {"ANYTHINGLLM_DEVELOPER_KEY": "k"})
    assert m.runner.calls == []
    assert not m.units.exists()


def test_without_systemd_the_default_is_native(m: Machine) -> None:
    target.install(storage(m), replace(m, runner=Systemctl(state="")))
    assert servers(m)[NAME]["command"] == PYTHON


def test_a_server_of_that_name_that_is_not_ours_is_never_overwritten(m: Machine) -> None:
    file = storage(m) / SERVERS_FILE
    file.write_text(json.dumps({"mcpServers": {NAME: {"command": "npx", "args": ["x"]}}}))
    with pytest.raises(SystemExit, match="not ours"):
        target.install(storage(m), m, start=False)
    assert json.loads(file.read_text())["mcpServers"][NAME]["command"] == "npx"


def test_a_servers_file_that_is_not_json_is_named(m: Machine) -> None:
    (storage(m) / SERVERS_FILE).write_text("{not json")
    with pytest.raises(SystemExit, match=r"plugins.*is not JSON"):
        target.install(storage(m), m, start=False)


def test_systemctl_refusing_is_said_with_its_reason(m: Machine) -> None:
    with pytest.raises(SystemExit, match=r"enable --now .* failed: boom"):
        target.install(storage(m), replace(m, runner=Systemctl(refuse="enable")))


def test_the_storage_is_the_bridges_when_none_is_given(m: Machine) -> None:
    Path(m.env["BRIDGE_ENV_FILE"]).write_text(f"ANYTHINGLLM_STORAGE={storage(m)}\n")
    assert any(str(storage(m)) in line for line in target.install(None, m, start=False))


def test_without_a_storage_or_with_one_that_is_not_a_folder_it_says_so(m: Machine) -> None:
    with pytest.raises(SystemExit, match="say which AnythingLLM"):
        target.install(None, m)
    with pytest.raises(SystemExit, match="is not a folder"):
        target.install(m.home / "nowhere", m)


def test_uninstall_undoes_install_and_leaves_other_servers(m: Machine) -> None:
    file = storage(m) / SERVERS_FILE
    file.write_text(json.dumps({"mcpServers": {"mine": {"command": "x"}}}))
    target.install(storage(m), m)
    after = replace(m, runner=Systemctl())
    done = target.uninstall(storage(m), after)
    assert not list(m.units.glob(f"{UNIT}*"))
    assert servers(m) == {"mine": {"command": "x"}}
    assert after.runner.calls == [
        "is-system-running", f"disable --now {UNIT}.socket", "daemon-reload",
    ]
    assert sum(line.startswith("deleted") for line in done) == 2
    assert target.uninstall(storage(m), replace(m, runner=Systemctl())) == [
        f"no {NAME} entry in {file}"
    ]


def test_uninstall_without_systemd_still_removes_the_files_and_the_entry(m: Machine) -> None:
    target.install(storage(m), m)
    gone = replace(m, runner=Systemctl(state=""))
    done = target.uninstall(storage(m), gone)
    assert gone.runner.calls == ["is-system-running"]
    assert not list(m.units.glob(f"{UNIT}*"))
    assert NAME not in servers(m)
    assert sum(line.startswith("deleted") for line in done) == 2


def test_the_containers_storage_path_is_the_contracts() -> None:
    assert f"INNER_STORAGE={INSIDE}" in VERSIONS.read_text().splitlines()
