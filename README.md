# anythingllm-suite

Everything that extends a stock AnythingLLM, in one repository: a bridge to its internal API, MCP servers for the agent and other MCP clients, agent skills that run inside it, and the phone app that talks to the bridge.

| Part | Folder | Runs | Toolchain |
| --- | --- | --- | --- |
| Bridge to AnythingLLM's internal API | `packages/bridge` | beside AnythingLLM, as a service | Node 20+, no dependencies shipped |
| MCP servers (control: chat and schedule) | `packages/mcp` | started over stdio by an MCP client, or for AnythingLLM by systemd through a socket | Python 3.13, uv |
| Agent skills (apps, browser, memory) | `packages/skills/<name>` | inside AnythingLLM's own process | Node 18+, no dependencies shipped |
| Phone app (AnywhereLLM Lite) | `app` | on the phone | Flutter |

`packages/` holds what runs beside or inside AnythingLLM. `app/` is the client and has its own toolchain and release. `contract/` is what both sides agree on.

## Layout

```text
packages/bridge/    the bridge (TypeScript; ships as one file, anythingllm-bridge.cjs)
packages/mcp/       the MCP server, control (Python; distribution: anythingllm-mcp)
packages/skills/    one folder per skill; each ships as its own zip
packages/shared/    helpers both JavaScript parts bundle in (writeAtomic)
packages/package.json, tsconfig.json   the JavaScript parts' toolchain (bridge, skills): one install, one type-check
app/                the Flutter app
contract/           endpoints.md, default-allow.txt, versions.env: read by every part
tools/              check, package, install, boundaries
docs/               architecture.md; notes/ for decisions, repo-wide and per part
dist/               build output, ignored
```

## Rules

- **No part imports another.** A JavaScript part's build fails if its bundle takes in a file from outside its own `src/` (the helpers in `packages/shared/` aside; `build.test.mts` tests this), `tools/boundaries` fails if the app imports a path into another part, and a Python part cannot import a TypeScript one. Imports that are erased or not bundled (types, tests) are not checked. Parts share the contract and the tooling, never modules.
- **One version of AnythingLLM under test.** `contract/versions.env` pins the image every check uses.
- **Parts version and release on their own.** Tags are prefixed: `skills/memory-lean-v0.2.0`, `app-v1.4.0`.

## Checks

There is no hosted CI; `lefthook.yml` is the gate. `make` lists the commands; they only call `lefthook` or a script in `tools/`. After cloning, run `make hooks`. Ruff and `flutter analyze` run on commit, and `tools/boundaries` and `tools/check <part>` on push, each only when files of that part changed. `tools/check` knows the bridge, the skills and mcp. `make lint` and `make test` run those hooks on every file; `make check` tests everything. `make e2e` (`tools/e2e`) is not a hook: it starts a throwaway AnythingLLM in a container and the built bridge in front of it, and runs the MCP servers against them, with podman including the server's `install` into the container's storage (about 25 seconds once the image is pulled). Nothing here tests Windows or macOS.

## Status

Moved in: the `memory` skill (ported to TypeScript, not yet run in a real AnythingLLM) and the bridge (rewritten in TypeScript from the Python toolkit; `make e2e` runs it in front of a real AnythingLLM, but only for the routes the control server calls). `packages/mcp` holds the `control` server: chat and schedule, as roles of one MCP server, against the bridge (tested against a real AnythingLLM by `make e2e`); `anythingllm-mcp-control install` puts it where AnythingLLM can start it; the memory and sandbox servers and the old deploy command are still in `anythingllm-mcp`. Not yet: `app/` (holds a `.gitkeep`), the other skills, `tools/install`, and the container checks.
