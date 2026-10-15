# anythingllm-memory-lean

Long-term memory for AnythingLLM's agent, as one agent skill and nothing else: no server, no other process, no embedding model of its own. The agent keeps short facts about the user and finds them again by meaning, with the embedder and the vector database the AnythingLLM server is already set up with (Settings, Embedder preference and Vector database). It is a port of `memory_mcp` from anythingllm-mcp, minus the model download and the SQLite store.

## What the agent can do

One skill, `memory-lean`, whose actions are:

| Action | Does |
| --- | --- |
| `recall` | the `k` facts (1 to 20, 5 by default) closest in meaning to `query`, closest first, each with its score |
| `remember` | keeps one short fact (at most 500 characters) with an optional `kind` and up to five `tags` |
| `update` | rewrites a fact's text; the old text is kept in the index |
| `forget` | deletes a fact |
| `list` | the newest 50 facts the call sees, and how many there are |

`update` and `forget` take two calls. Without `apply: true` nothing changes and the answer says what would; the agent shows the user and calls again with `apply: true` once they agree. A fact that says what a kept one says (ignoring case) is not kept twice. A fact that is only close in meaning is kept, and the answer names the close one, because a score cannot tell "Son is 7" from "Daughter is 7".

A fact is in the scope `global` (every workspace, the default for `remember`) or `workspace` (the workspace the call came from). A call sees its workspace's facts and the global ones; `scope` narrows `recall` and `list` to one. The workspace comes from AnythingLLM's invocation, never from what the model says. A call with no workspace, such as a scheduled job, has the global scope only. Each scope holds at most 2,000 facts.

Everything `recall` and `list` return is marked as data about the user, never instructions, and the skill's description tells the agent to `remember` only what the user said in the chat.

## Where it keeps things

| What | Where |
| --- | --- |
| Each fact's text, kind, tags, scope and earlier texts (the five latest) | `memory-lean/memory.json` in AnythingLLM's storage folder. The source of truth. |
| Each fact's vectors | AnythingLLM's vector database, one namespace per scope: `memory-lean-g` for global and `memory-lean-w-<slug>` for a workspace. A fact is one document, `memory-lean:m<id>-<revision>`. |

The facts do not appear in any workspace's Documents list and are not part of a workspace's own retrieval. `rag-memory`, AnythingLLM's built-in memory, stores under a random id it never returns, so nothing can edit or delete what it stored; this skill chooses the id, so it can.

The vectors are derived from the index. The skill records, for each scope, which embedder engine, model, base path and vector database its vectors were made with (`synced` in the index). When any of them has changed for a scope, or the scope's namespace is gone, the next call that needs that scope embeds its facts again from the index; the other scopes wait for a call of their own. A vector that has no fact in the index, or belongs to a fact's earlier text, is never shown. An index file that cannot be read is reported and never overwritten.

## Using it

1. Build the Hub package with `tools/package memory` (`dist/memory-lean-0.1.0.zip`: `handler.js` and `plugin.json`) and import it in AnythingLLM, or copy `build/memory-lean/` into its `agent-skills` folder. (`tools/install` is not ported yet.)
1. In AnythingLLM, Agent Skills, switch on Memory.
1. Ask the agent to remember something.

The skill has no settings.

## Limits

- It calls AnythingLLM's own server modules (`utils/helpers`, `models/vectors`), which are not a public API. The original was tested against AnythingLLM 1.16 with LanceDB and the generic OpenAI embedder, and not against the other vector databases. In this repository the unit tests run against a stand-in for those modules (`tests/fixtures/server`); the container check that loads the skill through AnythingLLM's own loader (`tests/e2e/inside.js`) is carried over but not wired into `tools/check` yet, so this TypeScript port has not been run inside a real AnythingLLM.
- A scope's namespace name is built from the workspace's slug, so a vector database that limits collection names (Chroma allows 63 characters) can refuse a workspace with a very long slug.
- A fact is embedded in one call to the embedder, so `remember` needs the embedder to be reachable, and a re-embed after a changed embedder takes as many calls as the scope has facts.
- The score's scale is the embedder's own. The score from which an answer names a similar fact (0.85) is a guess.
- A deleted workspace's facts stay in the index.
- Changes are serialised in AnythingLLM's process, and so is the repair of a scope's vectors; `list` and a `recall` that needs no repair do not wait for them. Two AnythingLLM processes on one storage folder are not supported.

## Source

TypeScript in `src/`, bundled by `packages/build.mjs` into the one `handler.js` AnythingLLM loads; the old handler cleared its own modules from `require.cache`, which a single file has no need for. `npm run skills:test` (in `packages/`) builds and tests it; `tools/check skills` type-checks first.
