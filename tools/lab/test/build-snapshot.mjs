// Bundles the browser skill's own page reader (snapshot.ts and what it imports) into test/.snapshot.mjs,
// so npm run check reads every page exactly as the skill does. SKILL_DIR points at the skill's folder.

import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";

const SKILL = process.env.SKILL_DIR || path.resolve(import.meta.dirname, "../../../packages/skills/browser");
const entry = path.join(SKILL, "src", "snapshot.ts");
if (!fs.existsSync(entry)) {
  console.error(`The skill's snapshot.ts isn't at ${entry}. Set SKILL_DIR to the browser skill's folder.`);
  process.exit(1);
}
await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "node", outfile: path.join(import.meta.dirname, ".snapshot.mjs"), logLevel: "warning" });
console.log(`Built test/.snapshot.mjs from ${entry}`);
