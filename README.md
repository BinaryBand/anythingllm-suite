# anythingllm-suite

Everything that extends a stock AnythingLLM, in one repository: a bridge to its internal API, MCP servers for the agent and other MCP clients, agent skills that run inside it, and the phone app that talks to the bridge.

| Part | Folder | Runs | Toolchain |
| --- | --- | --- | --- |
| Bridge to AnythingLLM's internal API | `packages/bridge` | beside AnythingLLM, as a service | Node 20+, no dependencies shipped |
| MCP servers (chat, schedule, memory, sandbox) | `packages/mcp` | started by an MCP client over stdio | Python 3.13, uv |
| Agent skills (apps, browser, memory) | `packages/skills/<name>` | inside AnythingLLM's own process | Node 18+, no dependencies shipped |
| Phone app (AnywhereLLM Lite) | `app` | on the phone | Flutter |

`packages/` holds what runs beside or inside AnythingLLM. `app/` is the client and has its own toolchain and release. `contract/` is what both sides agree on.

## Layout

```text
packages/bridge/    the bridge (TypeScript; ships as one file, anythingllm-bridge.cjs)
packages/mcp/       the MCP servers (Python; distribution: anythingllm-mcp)
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

There is no hosted CI; `lefthook.yml` is the gate. `make` lists the commands; they only call `lefthook` or a script in `tools/`. After cloning, run `make hooks`. Ruff and `flutter analyze` run on commit, and `tools/boundaries` and `tools/check <part>` on push, each only when files of that part changed. `tools/check` knows the bridge and the skills. `make lint` and `make test` run those hooks on every file; `make check` tests everything. Nothing here tests Windows or macOS.

## Status

Moved in: the `memory` skill (ported to TypeScript, not yet run in a real AnythingLLM) and the bridge (rewritten in TypeScript from the Python toolkit, not yet run against a real AnythingLLM). Not yet: `packages/mcp` and `app/` (each holds a `.gitkeep`), the other skills, `tools/install`, and the container checks. The MCP servers still call the bridge by the toolkit's old names; see the notes.
