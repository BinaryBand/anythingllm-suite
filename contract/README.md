# contract

What the parts agree on. No build, no version of its own.

| File | Holds | Read by |
| --- | --- | --- |
| `versions.env` | the AnythingLLM image under test, its inner port, the bridge's port | `tools/lib.sh` |
| `default-allow.txt` | the default `BRIDGE_ALLOW`: the routes the phone app and the chat and schedule servers call | the bridge (inlined into its build, and its tests); the MCP and app tests |
| `endpoints.md` | AnythingLLM's internal routes worth opening, with their shapes (copied from anythingllm-toolkit's `docs/notes/endpoints.md`) | people |

A route added to one part's calls is added here first. The other parts' tests read this folder, so they fail until they follow.
