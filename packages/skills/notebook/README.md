# notebook-lean

A notebook AnythingLLM's agent keeps for itself: short notes that every chat and scheduled job share, written at the agent's own judgement. It took the place of the memory skill (archived on the branch `archive/memory-skill`), without its embedder and vector database.

- **Actions:** `read` (the newest notes, or those with the most of a query's words), `write`, `edit` and `delete` by a note's number.
- **Where:** one file, `<storage>/notebook-lean/notebook.json`, changed under its lock, since a scheduled job runs in a process of its own. Uninstalling the skill leaves it.
- **Limits:** 500 notes, 1000 characters each; a read shows 30.
- **What it needs of AnythingLLM:** the storage folder (`STORAGE_DIR`), and nothing else: no model, no vectors, no server modules, no workspace scope.

## Check

`tests/handler.test.mts` runs against the built bundle (`npm run skills:test` in `packages/`).
