# Notes

Repo-wide decisions and their reasons. A part's own notes live in its `docs/notes/`.

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
- **Not done yet:** `esbuild` is not a dependency until the first skill is built; `tools/boundaries` has no TypeScript rules (its JavaScript rules already check a bundle, but a source rule must allow `#shared` and forbid reaching another skill, and the boundaries hook's glob stays without `ts` until then); `tools/check skills` should replace the hard-coded `-p shared` in the package scripts by looping over every skill's `tsconfig.json` and tests.
