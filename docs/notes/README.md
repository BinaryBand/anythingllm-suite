# Notes

Repo-wide decisions and their reasons. A part's own notes live in its `docs/notes/`.

## Layout, 2026-10-15

- `packages/` holds what runs beside or inside AnythingLLM (bridge, mcp, skills). `app/` is the phone client and sits outside it. `contract/` is shared data, not a package.
- The two Python parts form a uv workspace (one lock, shared ruff rules) but stay separate distributions. Sharing tooling is allowed; sharing modules is not.
- Each skill ships as its own zip, so a skill is the package, and `packages/skills/` only groups them.
- No `.github/`. The gate is `lefthook.yml` calling the scripts in `tools/`, so the root gets one file and no hooks folder, and local and any later CI run the same scripts. The cost: nothing tests Windows or macOS (`launchd.py`, `schtasks.py` in the bridge, the mcp deploy's native mode), a hook can be skipped with `--no-verify`, and there is no clean-room run. A hosted workflow can come back for the OS matrix alone.
- Parts are named by role. The bridge's distribution keeps the name `anythingllm-toolkit`; renaming a published name is a separate decision.
