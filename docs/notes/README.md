# Notes

Repo-wide decisions and their reasons. A part's own notes live beside this file, under `docs/notes/<group>/<part>/`: [skills/memory](skills/memory/README.md) is the first.

## Layout, 2026-10-15

- `packages/` holds what runs beside or inside AnythingLLM (bridge, mcp, skills). `app/` is the phone client and sits outside it. `contract/` is shared data, not a package.
- The two Python parts form a uv workspace (one lock, shared ruff rules) but stay separate distributions. Sharing tooling is allowed; sharing modules is not.
- Each skill ships as its own zip, so a skill is the package, and `packages/skills/` only groups them.
- No `.github/`. The gate is `lefthook.yml` calling the scripts in `tools/`, so the root gets one file and no hooks folder, and local and any later CI run the same scripts. The cost: nothing tests Windows or macOS (`launchd.py`, `schtasks.py` in the bridge, the mcp deploy's native mode), a hook can be skipped with `--no-verify`, and there is no clean-room run. A hosted workflow can come back for the OS matrix alone.
- Parts are named by role. The bridge's distribution keeps the name `anythingllm-toolkit`; renaming a published name is a separate decision.

## TypeScript under packages/skills, 2026-10-15

- **One config, at `packages/skills/`**, beside `package.json`; the repository root has neither, because it is Python and Flutter. A skill's own `tsconfig.json` extends `tsconfig.base.json` and includes its `src` and `../shared`.
- **`shared/` holds helpers, and a skill's zip still stands alone.** A skill imports `#shared/...`, which `package.json`'s `imports` field maps to `shared/*.ts`; Node, `tsc` and `esbuild` all resolve it, so tests, the type-check and the bundle use one mechanism (a `paths` alias would be invisible to Node). `esbuild` bundles the helper into the skill's `handler.js`, which then requires only Node built-ins; `tsc` alone would leave the import in the output. This relaxes the old rule "nothing a skill ships imports from outside it": `shared/` is dependency-free source copied in at build, never a runtime import, so a fix in it reaches a skill only when that skill is rebuilt. First helper: `writeAtomic`, written separately in `apps`, `browser` and `memory`.
- **Node 22.18+ to develop, Node 18 for the shipped code.** Node runs `.ts` itself (type stripping), so there is no `tsx`; `typescript` and `@types/node@18` are the only dev dependencies, the second so that a newer API fails the type-check. Bundle with `--target=node18`. `erasableSyntaxOnly` keeps the source strippable (no enums); TypeScript 7 dropped `moduleResolution: node`, so the base uses `module: preserve` with `bundler`.
- **ESM is scoped to the folders that are ESM.** `shared/package.json` sets `"type": "module"`. Setting it at `packages/skills/` would break every existing CommonJS skill, which uses `require`. A skill that gets TypeScript source and tests gives that folder the same nested `package.json`, or Node prints a typeless-package warning.
- **Not done yet:** `tools/check skills` should loop over every skill's `tsconfig.json` and tests instead of the hard-coded `tsc -p shared && tsc -p memory`; files a skill ships beyond `handler.js` and `plugin.json` need a place in `build.mjs`.


## The memory skill, first to move in, 2026-10-15

- **Unit tests run against the built bundle**, not the TypeScript source: they test what AnythingLLM loads, the reload test clears `require.cache` for that one file as before, and the source never has to run as ESM, where `require` and `__dirname` (used to reach AnythingLLM's modules and storage) do not exist. `npm test` builds first.
- **The test is `handler.test.mts`**, ESM by its extension, so `tests/` needs no `package.json`; one with `"type": "module"` also turned the CommonJS fixtures under it into ESM and broke them.
- **Fixtures and the e2e script stay `.js`.** They stand in for, or run inside, AnythingLLM's own JavaScript, and the e2e runs in the container's Node.
- **A skill is a folder with a `plugin.json`, and ships `build/<hubId>`;** the old `skill.config` is gone. `build.mjs` fails the build when a bundle takes in a file from outside the skill's `src/` and `shared/`. That check replaced two ast-grep rules, which matched a folder (`skill/`) that no longer exists and so scanned nothing.
- **Not run:** the port has not been loaded by a real AnythingLLM (the skill's README says so); `tools/install` and the container check are not ported.
