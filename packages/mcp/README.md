# anythingllm-mcp

MCP servers for MCP clients (Claude Desktop, Claude Code, an IDE), each its own process, started by the client over stdio. So far there are two, each the smallest of its kind: a skeleton to grow from.

| Server | Command | Tools |
| --- | --- | --- |
| hello | `anythingllm-mcp-hello` | `hello(name="world")` |
| world | `anythingllm-mcp-world` | `world_workspaces()`: calls the bridge's `GET /workspaces` |

## Run it

```sh
uv --directory packages/mcp run anythingllm-mcp-hello    # serves over stdio
```

An MCP client starts it with that command, for example in `mcpServers`:

```json
{ "hello": { "command": "uv", "args": ["--directory", "/path/to/anythingllm-suite/packages/mcp", "run", "anythingllm-mcp-hello"] } }
```

stdout is the MCP channel, so nothing else prints to it.

`world` reads `ANYTHINGLLM_BRIDGE_URL` (default `http://127.0.0.1:8467`) and `ANYTHINGLLM_DEVELOPER_KEY` from its environment.

## Test it

`tools/check mcp` runs ruff, then pytest:

- `test_stdio.py` starts `hello` as an MCP client does and calls its tool.
- `test_world.py` runs `world` against a mock transport: the request it sends (route, method, key), what each refusal becomes for the agent, and that every route it calls is passed by `contract/default-allow.txt`, read with the bridge's own rules (`allow.mts`). A server that starts calling a route the list lacks fails here, before the bridge answers 403.
- `test_world_stdio.py` starts `world` over stdio against a stand-in bridge on a free port, so the address and key come from the environment and the call crosses real HTTP.

`tools/e2e` (`make e2e`) is the real thing, and not part of `tools/check`: it starts a throwaway AnythingLLM (the image in `contract/versions.env`) and the bridge built from `packages/bridge` with the default `BRIDGE_ALLOW`, makes a developer key and a workspace, and runs `e2e/` against them. It checks that `world` lists the real workspace, says a refused key and an absent bridge in words, and that the bridge passes `GET /workspaces` and refuses `GET /system/api-keys`. Everything it starts is removed afterwards, pass or fail, and what already runs on the machine is left alone. It needs podman or docker, Node 22.18+ and uv. `e2e/` is outside `testpaths`, and its tests skip themselves when run on their own.

## Growing it

- A server is a package under `src/` named `<name>_mcp`, with its `server.py` (`build_server()`), a `__main__.py`, a line in `[project.scripts]` and its name in `module-name`.
- A server that talks to AnythingLLM goes through the bridge, with a developer key; the bridge's `BRIDGE_ALLOW` decides what passes, and a route a server calls is added to `contract/default-allow.txt` first. The bridge's address is `ANYTHINGLLM_BRIDGE_URL`, which `anythingllm-bridge install` writes with the key to `~/.config/anythingllm-mcp/<server>.env`.
- Add import-linter when a shared package (a bridge client) has servers over it to keep apart, and a `reported` wrapper (a shared error type becomes the tool's `ToolError`) when servers share that client; `world` raises `ToolError` itself until then.
