// Builds the JavaScript parts with esbuild. Each part becomes one file that needs nothing installed
// beside it, and the build fails (removing the output) when a bundle took in a file from outside its
// part: that is the boundary between parts, since a part cannot ship another part's code.
//
//   bridge  src/main.mts -> bridge/dist/anythingllm-bridge.cjs, for Node 20 or later. The extension is
//           fixed (.cjs) so it runs the same wherever it is copied to. contract/default-allow.txt is
//           inlined (the one copy of the default BRIDGE_ALLOW). Allowed: src/ and the contract.
//   skills  each skill's src/handler.ts -> <skill>/build/<hubId>/handler.js plus plugin.json, the
//           folder AnythingLLM unpacks, for Node 18. esbuild folds src/ and shared/ into the one
//           handler.js, which then requires only Node's own modules (and AnythingLLM's, by a path
//           built at run time). Allowed: the skill's src/ and shared/. Files a skill ships beyond
//           those two (a guide, JSON data) are not handled yet; add them here when apps and browser
//           move in.
//
// usage: node build.mjs [bridge | skills [skill ...]]   (no argument: the bridge and every skill)
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";

const here = import.meta.dirname;

/** Bundles `entry` into `outfile`; `allowed` are path prefixes relative to `here`, as esbuild's
 *  metafile writes them. `clean` is what to remove if the bundle took in anything else. */
async function bundle({ entry, outfile, target, loader, allowed, label, clean = outfile }) {
  const { metafile } = await build({
    absWorkingDir: here,
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "node",
    target,
    format: "cjs",
    loader,
    metafile: true,
    logLevel: "warning",
  });
  const stray = Object.keys(metafile.inputs).filter((file) => !allowed.some((prefix) => file.startsWith(prefix)));
  if (stray.length) {
    fs.rmSync(clean, { recursive: true, force: true });
    throw new Error(`${label} bundles files outside ${allowed.join(", ")}: ${stray.join(", ")}`);
  }
}

async function buildBridge() {
  const outfile = path.join(here, "bridge", "dist", "anythingllm-bridge.cjs");
  await bundle({
    entry: "bridge/src/main.mts",
    outfile,
    target: "node20",
    loader: { ".txt": "text" },
    allowed: ["bridge/src/", "../contract/"],
    label: "the bridge",
  });
  fs.chmodSync(outfile, 0o755);
  console.log(`built bridge -> ${path.relative(here, outfile)}`);
}

async function buildSkills(names) {
  const skills = names.length ? names : fs.readdirSync(path.join(here, "skills")).filter((name) => fs.existsSync(path.join(here, "skills", name, "src", "handler.ts")));
  for (const name of skills) {
    const dir = path.join(here, "skills", name);
    const { hubId, entrypoint } = JSON.parse(fs.readFileSync(path.join(dir, "plugin.json"), "utf8"));
    const out = path.join(dir, "build", hubId);
    fs.rmSync(out, { recursive: true, force: true });
    await bundle({
      entry: path.join(dir, "src", "handler.ts"),
      outfile: path.join(out, entrypoint.file),
      target: "node18",
      allowed: [`skills/${name}/src/`, "skills/shared/"],
      label: name,
      clean: out,
    });
    fs.copyFileSync(path.join(dir, "plugin.json"), path.join(out, "plugin.json"));
    console.log(`built ${name} -> ${path.relative(here, out)}`);
  }
}

const [part, ...names] = process.argv.slice(2);
if (part && part !== "bridge" && part !== "skills") throw new Error(`usage: node build.mjs [bridge | skills [skill ...]], not ${part}`);
if (part !== "skills") await buildBridge();
if (part !== "bridge") await buildSkills(names);
