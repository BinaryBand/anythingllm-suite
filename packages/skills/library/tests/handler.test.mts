// The skill as the agent uses it: the built handler.js (build/library-lean, what AnythingLLM loads)
// and the storage it keeps its data in. `npm run skills:test` builds the bundle first.

import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { check } from "../src/sandbox.ts";

const require = createRequire(import.meta.url);
const testsDir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.join(testsDir, "..");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "library-lean-"));
const storage = path.join(tmp, "storage");
process.env.STORAGE_DIR = storage;
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const bundle = path.join(skillDir, "build", "library-lean", "handler.js");
const handler = (): ((this: unknown, args: Record<string, unknown>) => Promise<string>) => {
  delete require.cache[bundle];
  return require(bundle).runtime.handler;
};

/** Calls the skill as AnythingLLM's agent would, from workspace `slug` (null: none, as a job). */
function call(args: Record<string, unknown>, slug: string | null = "work"): Promise<string> {
  const self = { super: { handlerProps: { invocation: slug ? { workspace: { slug }, thread_id: 3 } : {} } }, runtimeArgs: {}, logger: () => {} };
  return handler().call(self, args);
}

/** The shipped static files, as the repository holds them. */
const shipped = (sub: string): string[] => fs.readdirSync(path.join(skillDir, "static", sub)).sort();
const read = (name: string): string => fs.readFileSync(path.join(skillDir, "static", name), "utf8");

test("guide with no topic gives the overview; with a topic, that topic", async () => {
  assert.equal(await call({ action: "guide" }), read("guide/index.md").trim());
  assert.equal(await call({ action: "guide", topic: "Functions" }), read("guide/functions.md").trim());
  assert.match(await call({ action: "guide", topic: "nothing" }), /^Library: there's no topic "nothing"; the topics are: functions, snippets\.$/);
  assert.equal(await call({}), read("guide/index.md").trim(), "guide is the default");
  assert.match(await call({ action: "fly" }), /action is guide, not "fly"/);
});

test("a snippet is given to adapt, and an unknown one names the ones there are", async () => {
  const answer = await call({ action: "guide", snippet: "cursor-pagination" });
  assert.ok(answer.startsWith("Snippet cursor-pagination (a worked example: adapt it, don't save it as is):"));
  assert.ok(answer.endsWith(read("snippets/cursor-pagination.js").trim()));
  assert.match(await call({ action: "guide", snippet: "nope" }), /no snippet "nope"; the snippets are: cursor-pagination/);
});

test("a guide topic tuned on this instance wins, says where it lives, and a topic added there is listed", async () => {
  const own = path.join(storage, "library-lean", "static", "guide");
  fs.mkdirSync(own, { recursive: true });
  fs.writeFileSync(path.join(own, "functions.md"), "Tuned: keep functions short.\n");
  fs.writeFileSync(path.join(own, "billing.md"), "How this user's billing APIs work.\n");
  try {
    assert.equal(await call({ action: "guide", topic: "functions" }), `Tuned: keep functions short.\n\n(Tuned on this instance: ${path.join(own, "functions.md")})`);
    assert.match(await call({ action: "guide", topic: "billing" }), /^How this user's billing APIs work\./);
    assert.match(await call({ action: "guide", topic: "nothing" }), /the topics are: billing, functions, snippets/);
  } finally {
    fs.rmSync(path.join(storage, "library-lean"), { recursive: true, force: true });
  }
});

// Drift: what the static files say must match what the skill has, so polishing one can't break it.

test("every guide topic is listed in the overview, and every topic listed there has a file", () => {
  const files = shipped("guide").filter((f) => f !== "index.md").map((f) => f.replace(/\.md$/, ""));
  const listed = [...read("guide/index.md").matchAll(/^- `([a-z-]+)`:/gm)].map((m) => m[1]).sort();
  assert.deepEqual(listed, files);
});

test("every snippet is listed in the snippets topic, and compiles as a function", async () => {
  const files = shipped("snippets").map((f) => f.replace(/\.js$/, ""));
  const listed = [...read("guide/snippets.md").matchAll(/^- `([a-z-]+)`:/gm)].map((m) => m[1]).sort();
  assert.deepEqual(listed, files);
  for (const file of shipped("snippets")) {
    assert.equal(await check(read(`snippets/${file}`)), null, file);
  }
});

test("the bundle ships two files, with the static folder inside handler.js", () => {
  const built = path.join(skillDir, "build", "library-lean");
  assert.deepEqual(fs.readdirSync(built).sort(), ["handler.js", "plugin.json"]);
  const bytes = fs.readFileSync(path.join(built, "handler.js"));
  assert.ok(bytes.toString("utf8").includes("cursor-pagination.js"));
  assert.ok(!bytes.includes(0), "text, which install's payload and the Hub's upload both carry");
});
