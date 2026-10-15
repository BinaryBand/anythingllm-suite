# anythingllm-suite

Everything that extends a stock AnythingLLM, in one repository: a bridge to its internal API, MCP servers for the agent and other MCP clients, agent skills that run inside it, and the phone app that talks to the bridge.

| Part | Folder | Runs | Toolchain |
| --- | --- | --- | --- |
| Bridge to AnythingLLM's internal API | `packages/bridge` | beside AnythingLLM, as a service | Python 3.13, uv |
| MCP servers (chat, schedule, memory, sandbox) | `packages/mcp` | started by an MCP client over stdio | Python 3.13, uv |
| Agent skills (apps, browser, memory) | `packages/skills/<name>` | inside AnythingLLM's own process | Node 18+, no dependencies shipped |
| Phone app (AnywhereLLM Lite) | `app` | on the phone | Flutter |

`packages/` holds what runs beside or inside AnythingLLM. `app/` is the client and has its own toolchain and release. `contract/` is what both sides agree on.

## Layout

```text
packages/bridge/    the bridge (distribution: anythingllm-toolkit)
packages/mcp/       the MCP servers (distribution: anythingllm-mcp)
packages/skills/    one folder per skill; each ships as its own zip
app/                the Flutter app
contract/           endpoints.md, default-allow.txt, versions.env: read by every part
tools/              check, package, install, boundaries
docs/               architecture.md; notes/ for decisions, repo-wide and per part
dist/               build output, ignored
```

## Rules

- **No part imports another.** `tools/boundaries` fails when one does, and a skill's build fails if its bundle takes in anything outside its own `src/` and `shared/`. Parts share the contract and the tooling, never modules.
- **One version of AnythingLLM under test.** `contract/versions.env` pins the image every check uses.
- **Parts version and release on their own.** Tags are prefixed: `skills/memory-lean-v0.2.0`, `app-v1.4.0`.

## Checks

There is no hosted CI; `lefthook.yml` is the gate. `make` lists the commands; they only call `lefthook` or a script in `tools/`. After cloning, run `make hooks`. Ruff and `flutter analyze` run on commit, and `tools/boundaries` and `tools/check <part>` on push, each only when files of that part changed. `make lint` and `make test` run those hooks on every file; `make check` tests everything. Nothing here tests Windows or macOS.

## Status

Scaffolding only. The parts have not been moved in yet; each of `packages/*` and `app/` holds a `.gitkeep`. Next: bring each part in with its history (`git filter-repo --to-subdirectory-filter`), then fill in `tools/`.
