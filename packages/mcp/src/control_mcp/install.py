"""control_mcp.install: puts the control server where AnythingLLM can start it.

AnythingLLM usually runs in a container, which has no Python, so the server runs on the host and
the container reaches it through a unix socket in its own storage folder: systemd (a socket unit
and a service template, one server started for each connection) owns the socket, and the entry in
AnythingLLM's servers file runs a one-line `node` relay inside the container that joins its stdio
to that socket. For a client that starts commands itself (`--native`) the entry is the command.

The service runs `python -m control_mcp` with the python that is running this, so a checkout's
`uv run anythingllm-mcp-control install` runs that checkout's code. Its settings are the
`control.env` that `anythingllm-bridge install` writes. Every failure is a SystemExit with its
message."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path

NAME = "control"
UNIT = f"anythingllm-mcp-{NAME}"
SHARE = "anythingllm-mcp"  # the folder in the storage that holds the socket
SOCK = f"{SHARE}/{NAME}.sock"
INSIDE = "/app/server/storage"  # where AnythingLLM's container sees its storage
SERVERS_FILE = Path("plugins") / "anythingllm_mcp_servers.json"
SYSTEMCTL = ("systemctl", "--user")
# The relay run inside the container: `node -e RELAY <socket>` has the socket as process.argv[1].
# e2e/test_install.py is its test, with a real AnythingLLM; the unit tests only see its text.
RELAY = (
    "const c=require('net').createConnection(process.argv[1]);"
    "process.stdin.pipe(c);c.pipe(process.stdout);c.on('close',()=>process.exit(0));"
    "c.on('error',e=>{console.error(e.message);process.exit(1)});process.stdin.on('end',()=>c.end())"
)

type Run = Callable[[Sequence[str]], subprocess.CompletedProcess[str]]


def run(args: Sequence[str]) -> subprocess.CompletedProcess[str]:
    """Runs a command, never through a shell; a command that is not installed is a 127."""
    try:
        return subprocess.run(list(args), capture_output=True, text=True, check=False)
    except FileNotFoundError as error:
        return subprocess.CompletedProcess(list(args), 127, "", str(error))


def parse_env(text: str) -> dict[str, str]:
    """The `KEY=value` lines of an environment file, a pair of quotes round a value dropped."""
    values = {}
    for raw in text.splitlines():
        key, equals, value = raw.strip().partition("=")
        key, value = key.strip(), value.strip()
        if equals and key and not key.startswith("#"):
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":  # noqa: PLR2004
                value = value[1:-1]
            values[key] = value
    return values


def quote(word: str) -> str:
    """`word` as one word of a unit's ExecStart."""
    if not any(c in word for c in " \t\"'\\$%"):
        return word
    escaped = word.replace("\\", "\\\\").replace('"', '\\"').replace("%", "%%").replace("$", "$$")
    return f'"{escaped}"'


def esc(path: Path) -> str:
    """`path` as the value of a unit's setting, where `%` starts a specifier."""
    return str(path).replace("%", "%%")


def socket_unit(socket: Path) -> str:
    return f"""\
# anythingllm-mcp's control server: AnythingLLM's container reaches it through this socket in its
# storage. systemd starts one server for each connection ({UNIT}@.service).
# Written by `anythingllm-mcp-control install`.
[Unit]
Description=anythingllm-mcp control server's socket

[Socket]
ListenStream={esc(socket)}
SocketMode=0600
DirectoryMode=0755
Accept=yes

[Install]
WantedBy=sockets.target
"""


def service_unit(python: str, env_file: Path) -> str:
    return f"""\
# One anythingllm-mcp control server, serving the connection systemd accepted as its stdin and
# stdout. Written by `anythingllm-mcp-control install`.
[Unit]
Description=anythingllm-mcp control server

[Service]
ExecStart={quote(python)} -m control_mcp
EnvironmentFile=-{esc(env_file)}
StandardInput=socket
StandardOutput=socket
StandardError=journal
"""


def container_entry() -> dict:
    return {"command": "node", "args": ["-e", RELAY, f"{INSIDE}/{SOCK}"]}


def native_entry(python: str, env: Mapping[str, str]) -> dict:
    entry: dict = {"command": python, "args": ["-m", "control_mcp"]}
    if env:
        entry["env"] = dict(env)
    return entry


def ours(entry: object) -> bool:
    """Whether an entry of the servers file starts the control server the way this writes it."""
    text = json.dumps(entry)
    return SOCK in text or "control_mcp" in text


def read_servers(path: Path) -> dict:
    """The JSON object in the servers file, an empty one when there is no file."""
    if not path.is_file():
        return {}
    try:
        config = json.loads(path.read_text() or "{}")
    except json.JSONDecodeError as error:
        raise SystemExit(f"{path} is not JSON ({error}); fix it first") from error
    if not isinstance(config, dict):
        raise SystemExit(f"{path} does not hold a JSON object")
    return config


def write(path: Path, text: str) -> bool:
    """Writes `text` unless the file holds it already; whether it wrote. In place, since a file in
    AnythingLLM's storage belongs to its user and group."""
    if path.is_file() and path.read_text() == text:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    return True


def set_entry(servers: Path, entry: dict | None) -> str:
    """Sets our entry in the servers file, or with None drops it; every other entry stays, and so
    do the settings AnythingLLM keeps in our entry (`anythingllm`: suppressed tools, autoStart)."""
    config = read_servers(servers)
    found = dict(config.get("mcpServers") or {})
    old = found.get(NAME)
    if old is not None and not ours(old):
        raise SystemExit(f"{servers} has a server named {NAME} that is not ours; rename it first")
    if entry is None and old is None:
        return f"no {NAME} entry in {servers}"
    if entry is None:
        del found[NAME]
    else:
        kept = old.get("anythingllm") if isinstance(old, dict) else None
        found[NAME] = {**entry, "anythingllm": kept} if kept else entry
    if not write(servers, json.dumps({**config, "mcpServers": found}, indent=2) + "\n"):
        return f"unchanged {servers}"
    return f"{'dropped' if entry is None else 'set'} {NAME} in {servers}"


@dataclass(frozen=True)
class Machine:
    """What install asks of the machine it runs on, so a test can give its own."""

    env: Mapping[str, str] = field(default_factory=lambda: dict(os.environ))
    home: Path = field(default_factory=Path.home)
    runner: Run = run
    python: str = sys.executable

    @property
    def units(self) -> Path:
        return Path(self.env.get("XDG_CONFIG_HOME") or self.home / ".config") / "systemd" / "user"

    @property
    def env_file(self) -> Path:
        folder = self.env.get("MCP_ENV_DIR") or self.home / ".config" / "anythingllm-mcp"
        return Path(folder) / f"{NAME}.env"

    def storage(self, given: Path | None) -> Path | None:
        """`given`, else AnythingLLM's storage as the bridge's settings file names it."""
        if given:
            return given
        default = self.home / ".config" / "anythingllm-bridge" / "bridge.env"
        file = Path(self.env.get("BRIDGE_ENV_FILE") or default)
        value = parse_env(file.read_text() if file.is_file() else "").get("ANYTHINGLLM_STORAGE", "")
        return Path(value).expanduser() if value else None

    def systemd_usable(self) -> bool:
        said = self.runner([*SYSTEMCTL, "is-system-running"]).stdout.strip()
        return said in ("running", "degraded", "starting")

    def systemctl(self, *args: str) -> None:
        done = self.runner([*SYSTEMCTL, *args])
        if done.returncode:
            why = done.stderr.strip()[-300:]
            raise SystemExit(f"systemctl --user {' '.join(args)} failed: {why}")


def install(
    storage: Path | None, machine: Machine | None = None, *, native: bool | None = None,
    start: bool = True,
) -> list[str]:
    """What it did, one line each. `native` None chooses: container where systemd answers."""
    machine = machine or Machine()
    storage = machine.storage(storage)
    if storage is None:
        raise SystemExit("say which AnythingLLM: --storage DIR (or `anythingllm-bridge install`)")
    if not storage.is_dir():
        raise SystemExit(f"{storage} is not a folder")
    if native is None:
        native = not machine.systemd_usable()
    done = []
    if native:
        text = machine.env_file.read_text() if machine.env_file.is_file() else ""
        entry = native_entry(machine.python, parse_env(text))
    else:
        socket = storage / SOCK
        socket.parent.mkdir(parents=True, exist_ok=True)
        for file, text in (
            (machine.units / f"{UNIT}.socket", socket_unit(socket)),
            (machine.units / f"{UNIT}@.service", service_unit(machine.python, machine.env_file)),
        ):
            done.append(f"{'wrote' if write(file, text) else 'unchanged'} {file}")
        if start:
            machine.systemctl("daemon-reload")
            machine.systemctl("enable", "--now", f"{UNIT}.socket")
            done.append(f"started {UNIT}.socket")
        entry = container_entry()
    return [*done, set_entry(storage / SERVERS_FILE, entry)]


def uninstall(storage: Path | None, machine: Machine | None = None) -> list[str]:
    """Stops and removes the socket and the units and drops our entry; what it did."""
    machine = machine or Machine()
    storage = machine.storage(storage)
    usable = machine.systemd_usable()
    if usable:
        machine.runner([*SYSTEMCTL, "disable", "--now", f"{UNIT}.socket"])
    done = []
    for file in (machine.units / f"{UNIT}{suffix}" for suffix in (".socket", "@.service")):
        if file.is_file():
            file.unlink()
            done.append(f"deleted {file}")
    if done and usable:
        machine.systemctl("daemon-reload")
    if storage is not None:
        (storage / SOCK).unlink(missing_ok=True)
        done.append(set_entry(storage / SERVERS_FILE, None))
    return done
