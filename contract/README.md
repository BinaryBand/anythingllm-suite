# contract

What the parts agree on. No build, no version of its own.

| File | Holds | Read by |
| --- | --- | --- |
| `versions.env` | the AnythingLLM image under test, its inner port, the bridge's port | `tools/lib.sh` |
| `default-allow.txt` | the default `BRIDGE_ALLOW`: the routes the phone app and the control server's chat and schedule roles call. One entry per line, `#` lines ignored, and a `# verified against AnythingLLM <version>` line that `tools/routes` keeps | the bridge (inlined into its build, and its tests); the MCP and app tests; `tools/routes` |
| `endpoints.md` | AnythingLLM's internal routes worth opening, with their shapes (copied from anythingllm-toolkit's `docs/notes/endpoints.md`) | people |

A route added to one part's calls is added here first. The other parts' tests read this folder, so they fail until they follow.

## When AnythingLLM changes

`versions.env` pins the image. After moving the pin, run `make routes`: it reads the route declarations out of that image and fails for any rule in `default-allow.txt` that has no declared route under it. When it passes, `tools/routes --stamp` records the version in `default-allow.txt`. Then reread `endpoints.md` for the routes whose shapes you rely on; the check sees paths and methods, not what a route returns.
