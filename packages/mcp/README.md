# anythingllm-mcp

MCP servers for MCP clients (Claude Desktop, Claude Code, an IDE), each its own process, started by the client over stdio. So far there is one, `hello`, the smallest server this repository builds: a skeleton to grow from.

| Server | Command | Tools |
| --- | --- | --- |
| hello | `anythingllm-mcp-hello` | `hello(name="world")` |

## Run it

```sh
uv --directory packages/mcp run anythingllm-mcp-hello    # serves over stdio
```

An MCP client starts it with that command, for example in `mcpServers`:

```json
{ "hello": { "command": "uv", "args": ["--directory", "/path/to/anythingllm-suite/packages/mcp", "run", "anythingllm-mcp-hello"] } }
```

stdout is the MCP channel, so nothing else prints to it.

## Test it

`tools/check mcp` runs ruff, then pytest. The one test starts the server as an MCP client does and calls its tool.

## Growing it

- A server is a package under `src/` named `<name>_mcp`, with its `server.py` (`build_server()`), a `__main__.py`, a line in `[project.scripts]` and its name in `module-name`.
- A server that talks to AnythingLLM goes through the bridge, with a developer key; the bridge's `BRIDGE_ALLOW` decides what passes, and a route a server calls is added to `contract/default-allow.txt` first. The bridge's address is `ANYTHINGLLM_BRIDGE_URL`, which `anythingllm-bridge install` writes with the key to `~/.config/anythingllm-mcp/<server>.env`.
- Add import-linter when there are two packages to layer, and a `reported` wrapper (an error becomes the tool's message) when a tool can raise.
