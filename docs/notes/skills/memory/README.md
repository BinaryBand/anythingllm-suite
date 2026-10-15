# Notes on packages/skills/memory/README.md

Why `memory-lean` is a skill over AnythingLLM's own embedder and vector database, and not the MCP server it ports. The reasoning is from the session of 2026-10-15; nothing here is a measured result except the check noted below.

## Why not the MCP server

`memory_mcp` runs its own embedding model (fastembed, about 70 MB downloaded on first start) and keeps its facts and vectors in SQLite. It works for any MCP client, but on AnythingLLM it is a second process with a second model beside the one the server already has. A skill runs in AnythingLLM's process and can reach the server's `utils/helpers`, as `research-lean` does for `getLLMProvider`.

## Why not AnythingLLM's `rag-memory`

`rag-memory` has `search` and `store`. `store` calls `addDocumentToNamespace` with a random `docId` it never returns, into the workspace's own namespace, so a stored memory cannot be found by id, rewritten or removed. `addDocumentToNamespace` takes any `docId`, and `deleteDocumentFromNamespace(namespace, docId)` removes by it, so a skill that chooses the id has edit and delete.

## Why the index holds the text

AnythingLLM drops every workspace's vectors when `EmbeddingEngine`, `EmbeddingModelPref` or `VectorDB` changes (`resetAllVectorStores`). It deletes workspace namespaces only, so a namespace of the skill's own survives in LanceDB, but its vectors are no longer comparable with a new embedder's. Facts kept only as vectors could not be embedded again. The index is the source of truth, and the vectors are rebuilt from it, as the repository keeps derived files separate from the files they derive from.

## Rejected

| Alternative | Why not |
| --- | --- |
| Memories as ordinary workspace documents (`document/raw-text` then `update-embeddings`) | They show in the Documents list and in chat and query retrieval, and a global scope would need a workspace of its own. |
| One namespace for all scopes, filtered after the search | The nearest `k` of everything may belong to scopes the call cannot see, so a scope's facts can be crowded out. |
| Keeping the fact's id in `title` | AnythingLLM prepends the title to each chunk before embedding it; the id is in `url`, which is not. |
| A scope named by the model | The workspace comes from the invocation. |

## Check

The lean version's `tools/check memory` on 2026-10-15 passed: 13 unit tests against a stand-in vector database, then the skill inside a stock AnythingLLM 1.16 container, loaded by `ImportedPlugin`, with LanceDB and the generic OpenAI embedder pointed at a stand-in that hashes words. It remembered, recalled, updated and forgot facts in two scopes, checked `DocumentVectors`, dropped a namespace and changed the embedder model, and the facts were found again.

The TypeScript port (same day) has the 16 unit tests of the later lean version, run against the built bundle: 16 pass, a changed message fails exactly one, and the bundle answered on Node 20. The container check was not run for it. `tests/e2e/inside.js` is the lean script, unchanged.

## Seen in the port, not changed

The handler looks an action up in a plain object, so the action `constructor` finds `Object` and the call answers with the arguments object instead of the "action is recall, remember..." text. The lean version did the same (checked on both); `toString` is safe because the name is lowercased first. `Object.hasOwn` would close it.
