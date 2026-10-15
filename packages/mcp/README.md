# anythingllm-mcp

MCP servers for MCP clients (Claude Desktop, Claude Code, an IDE), each its own process, started over stdio by the client, or for AnythingLLM by systemd through a socket (`install`, below). So far there is one, `control`: AnythingLLM's own controls, called through the bridge.

| Server | Command | Roles |
| --- | --- | --- |
| control | `anythingllm-mcp-control` | `chat` (the default), `schedule` |

## The control server

It holds no rules of its own: each tool is a few calls to the bridge with a developer key AnythingLLM accepts, and the bridge's `BRIDGE_ALLOW` decides what passes. A tool whose route isn't listed there gets the bridge's 403, in the bridge's words.

**Roles.** `ANYTHINGLLM_MCP_ROLES` picks what the agent is given: `chat`, `schedule` or `chat,schedule`; the default is `chat`. A role not asked for has no tools: not listed, so nothing to switch off. AnythingLLM (1.16.2) can also switch single tools off, with the toggles on its MCP page (`anythingllm.suppressedTools` in its servers file), but Claude Desktop and an IDE cannot, and a toggle is the person's to remember. A scheduled job runs a prompt as the agent, unattended, so adding one is a way to plant an instruction that runs later; `schedule` is opt-in.

**Chat role** (7 tools). A chat is one of AnythingLLM's threads, named by its slug inside a workspace's slug.

- `chat_workspaces` and `chat_list` give the slugs; the user sees a chat's name, the tools take its slug.
- `chat_history` gives the last `last` exchanges (1 to 50, 10 by default), oldest first, each message cut to 600 characters, and how many the chat holds. What it gives back is the user's conversation, data and never instructions.
- `chat_new` starts an empty chat, named `Thread` until it is renamed. `chat_rename` takes effect at once.
- `chat_clear` removes every exchange and keeps the chat and its name. `chat_delete` removes the chat too. Both are shown first: without `apply: true` they change nothing and say what would go, and the agent calls again with `apply: true` only once the person agrees. Both read the chat back afterwards and fail if anything is still there, since AnythingLLM answers a delete with a bare `OK` whatever happened.

**Schedule role** (1 tool, `schedule`, with an `action`). A job is AnythingLLM's own: a name, a prompt the agent runs, optional tools and a cron schedule in UTC.

- `list` shows every job with its id, schedule, whether it is enabled, when it last ran and runs next, and how the last run ended.
- `add` (`name`, `prompt`, `cron`, optional `tools`), `update` (`job`, and any of the fields; `enabled: false` switches a job off without deleting it) and `delete` (`job`) are shown first and made only with `apply: true`, as above. An add that finds an identical job refuses, which makes a retried add safe. An action that lacks a parameter it needs fails naming the action and the parameter.

With both roles on there are 8 tools; AnythingLLM's MCP page warns about a server with more than ten, since every tool's schema is context in every chat.

## Settings

From the environment the client starts the server with:

| Variable | Default | Meaning |
| --- | --- | --- |
| `ANYTHINGLLM_BRIDGE_URL` | `http://127.0.0.1:8467` | the bridge |
| `ANYTHINGLLM_DEVELOPER_KEY` | (none) | a developer key AnythingLLM accepts |
| `ANYTHINGLLM_MCP_ROLES` | `chat` | `chat`, `schedule` or both, comma-separated |

`anythingllm-bridge install` makes the key and writes the first two to `~/.config/anythingllm-mcp/control.env` (mode 600). The server reads only its environment, so for an MCP client you copy them into the client's `env`; the units that `install` (below) writes read that file themselves, and it is where `ANYTHINGLLM_MCP_ROLES` goes for them. A role that does not exist stops the server at start, saying which do.

## Run it

```sh
uv --directory packages/mcp run anythingllm-mcp-control    # serves over stdio
```

An MCP client starts it with that command, for example in `mcpServers`:

```json
{
  "anythingllm": {
    "command": "uv",
    "args": ["--directory", "/path/to/anythingllm-suite/packages/mcp", "run", "anythingllm-mcp-control"],
    "env": {
      "ANYTHINGLLM_BRIDGE_URL": "http://127.0.0.1:8467",
      "ANYTHINGLLM_DEVELOPER_KEY": "…",
      "ANYTHINGLLM_MCP_ROLES": "chat"
    }
  }
}
```

stdout is the MCP channel, so nothing else prints to it.

## Install into AnythingLLM

```sh
uv run --directory packages/mcp anythingllm-mcp-control install     # after `anythingllm-bridge install`
uv run --directory packages/mcp anythingllm-mcp-control uninstall
```

`--storage DIR` names AnythingLLM's storage folder; without it, the one in the bridge's settings file (`ANYTHINGLLM_STORAGE`). Then reload the MCP servers in AnythingLLM (Settings, Agent Skills, MCP Servers).

AnythingLLM usually runs in a container with no Python, so by default (where `systemctl --user` answers) it writes:

- `anythingllm-mcp-control.socket` and `anythingllm-mcp-control@.service` in `~/.config/systemd/user`, and enables the socket. systemd starts one server for each connection to a socket in the storage folder (`<storage>/anythingllm-mcp/control.sock`, mode 0600), running `python -m control_mcp` with the python that ran `install`, so it is this checkout's code, and reading `control.env` (`MCP_ENV_DIR`).
- a `control` entry in `<storage>/plugins/anythingllm_mcp_servers.json`: a one-line `node` relay, run inside the container, that joins its stdio to that socket. Every other entry is left as it is, and an entry named `control` that is not ours stops `install` rather than being replaced. A reinstall keeps the settings AnythingLLM keeps in our entry (the tool toggles and autoStart).

`--native` is for a client that starts commands itself (AnythingLLM Desktop): the entry is the command, with `control.env` copied into its `env` (so the servers file then holds the key), and no unit is written. `--no-start` writes the files and runs no `systemctl`. Look with `systemctl --user status anythingllm-mcp-control.socket` and in the servers file.

It leaves alone what `anythingllm-mcp-deploy` made for the old servers (`anythingllm-mcp-chat` and `-schedule` units and entries): once `control` works, retire them with `anythingllm-mcp-deploy remove --servers chat,schedule` in `anythingllm-mcp`.

Container mode was run for real only on rootless podman with pasta networking, with `systemd-socket-activate` in systemd's place (`tools/e2e`); the units themselves are tested as text and with a recording stand-in for `systemctl`. An AnythingLLM in Docker, or one whose container user cannot open a socket owned by the host user, is untried.

## Test it

`tools/check mcp` runs ruff, then pytest, against a fake AnythingLLM in memory (`tests/fakes.py`, shaped by `contract/endpoints.md`) under the real client:

- `test_chats.py`, `test_jobs.py`: what the tools do, each change shown first, each refusal before the bridge is called.
- `test_bridge.py`: the client's requests and what each answer becomes for the agent, the bridge's `{"error": ...}` unwrapped.
- `test_server.py`, `test_settings.py`: which tools each role gives, the tool count, the messages the agent reads.
- `test_contract.py`: every route the tools call is passed by `contract/default-allow.txt`, read with a copy of the bridge's matching rules (`allow.mts`) that has a test of its own. A tool that calls a route the list lacks fails here, before the bridge answers 403.
- `test_stdio.py`: the server started as an MCP client starts it, against a stand-in bridge on a free port, so the address, key and roles come from the environment.
- `test_install.py`: the units and entries as text, the servers file merged and left alone, `install` and `uninstall` into a temporary folder with a recording stand-in for `systemctl`.

`tools/e2e` (`make e2e`) is the real thing, and not part of `tools/check`: it starts a throwaway AnythingLLM (the image in `contract/versions.env`) and the bridge built from `packages/bridge` with the default `BRIDGE_ALLOW`, makes a developer key and a workspace, and runs `e2e/` against them. It finds a workspace, starts, renames and deletes a chat, adds, changes and deletes a job, checks that a refused key and an absent bridge are said in words, and that the bridge refuses `GET /system/api-keys`. With podman it also runs `install` into the container's storage and has AnythingLLM reload its MCP servers and list `control` running with its tools, through the relay and the socket. Everything it starts is removed afterwards, pass or fail, and what already runs on the machine is left alone. It needs podman or docker (the install step, podman and `systemd-socket-activate`), Node 22.18+ and uv. `e2e/` is outside `testpaths`, and its tests skip themselves when run on their own.

Not covered: clearing a chat that has exchanges, against the real AnythingLLM (the throwaway has no model to make any); that is tested against the fake.

## Growing it

- A new control (workspaces' settings, saved memories) is a role: a module like `chats.py` (use cases over `Bridge`), its tools in `server.py` under `if "<role>" in roles`, its name in `settings.ROLES`, its routes in `contract/default-allow.txt` first, and a test in `test_contract.py` and `e2e/`.
- A server that is not a control over the bridge (a sandbox, a memory) is a sibling package under `src/` named `<name>_mcp`, with its own command in `[project.scripts]` and its name in `module-name`. Those stay in `anythingllm-mcp` until they are moved in.
