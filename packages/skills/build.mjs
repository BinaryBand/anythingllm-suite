// Bundles each skill into the folder AnythingLLM unpacks: build/<hubId>/handler.js and plugin.json.
// esbuild folds src/ and ../shared into the one handler.js, which then requires only Node's own
// modules (and AnythingLLM's, by a path built at run time). The build fails if the bundle took in a
// file from anywhere but the skill's own src/ and shared/: that is the boundary check for skills.
// Files a skill ships beyond those two (a guide, JSON data) are not handled yet; add them here when
// apps and browser move in.
// usage: node build.mjs [skill ...]   (no skill: every folder here with src/handler.ts)
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";

const here = import.meta.dirname;
const skills = process.argv.length > 2
  ? process.argv.slice(2)
  : fs.readdirSync(here).filter((name) => fs.existsSync(path.join(here, name, "src", "handler.ts")));

for (const name of skills) {
  const dir = path.join(here, name);
  const { hubId, entrypoint } = JSON.parse(fs.readFileSync(path.join(dir, "plugin.json"), "utf8"));
  const out = path.join(dir, "build", hubId);
  fs.rmSync(out, { recursive: true, force: true });
  const { metafile } = await build({
    absWorkingDir: here,
    entryPoints: [path.join(dir, "src", "handler.ts")],
    outfile: path.join(out, entrypoint.file),
    bundle: true,
    platform: "node",
    target: "node18",
    format: "cjs",
    metafile: true,
    logLevel: "warning",
  });
  const stray = Object.keys(metafile.inputs).filter((file) => !file.startsWith(`${name}/src/`) && !file.startsWith("shared/"));
  if (stray.length) {
    fs.rmSync(out, { recursive: true, force: true });
    throw new Error(`${name} bundles files outside its src/ and shared/: ${stray.join(", ")}`);
  }
  fs.copyFileSync(path.join(dir, "plugin.json"), path.join(out, "plugin.json"));
  console.log(`built ${name} -> ${path.relative(here, out)}`);
}
