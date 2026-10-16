import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, test } from "node:test";
import { embed, eventsDir, inTurn, pageKey, putBack, take, watch, writePublic, publicDir } from "./pages.mts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pages-"));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
process.env.STORAGE_DIR = path.join(tmp, "storage");
process.env.ANYTHINGLLM_PUBLIC_DIR = path.join(tmp, "public");
process.env.ANYTHINGLLM_SERVER_DIR = path.join(tmp, "server");

// AnythingLLM's browser-extension keys, standing in: the ones it made are valid until revoked.
const made = new Set<string>();
fs.mkdirSync(path.join(tmp, "server", "models"), { recursive: true });
fs.writeFileSync(
  path.join(tmp, "server", "models", "browserExtensionApiKey.js"),
  `let n = 0; const made = globalThis.__made; module.exports = { BrowserExtensionApiKey: {
    validate: async (k) => made.has(k), create: async () => { const key = "brx-" + ++n; made.add(key); return { apiKey: { key } }; } } };`,
);
(globalThis as { __made?: Set<string> }).__made = made;

/** An event as AnythingLLM's collector writes what a page posted, `ms` ago. */
function posted(title: string, event: unknown, ms = 0, name = `${Math.random().toString(36).slice(2)}`) {
  fs.mkdirSync(eventsDir(), { recursive: true });
  const file = path.join(eventsDir(), `raw-${title}-${name}.json`);
  fs.writeFileSync(file, JSON.stringify({ id: name, pageContent: JSON.stringify(event) }));
  const at = new Date(Date.now() - ms);
  fs.utimesSync(file, at, at);
  return file;
}

beforeEach(() => fs.rmSync(eventsDir(), { recursive: true, force: true }));

test("events are taken oldest first, only the title's, each file deleted", () => {
  posted("library-lean-event", { n: 2 }, 1000);
  posted("library-lean-event", { n: 1 }, 2000);
  const other = posted("browser-lean-event", { n: 9 });
  assert.deepEqual(take("library-lean-event"), [{ n: 1 }, { n: 2 }]);
  assert.deepEqual(take("library-lean-event"), []);
  assert.ok(fs.existsSync(other), "another skill's events are left for it");
});

test("an event another process claimed (renamed) first isn't taken again", () => {
  const file = posted("c", { n: 1 });
  fs.renameSync(file, `${file}.taken-1`);
  posted("c", { n: 2 });
  assert.deepEqual(take("c"), [{ n: 2 }]);
});

test("an event put back is taken again by the next pass", () => {
  posted("c", { n: 1 });
  const [event] = take("c");
  putBack("c", event);
  assert.deepEqual(take("c"), [{ n: 1 }]);
});

test("a file still being written waits; one that stays unreadable is dropped as null", () => {
  fs.mkdirSync(eventsDir(), { recursive: true });
  const partial = path.join(eventsDir(), "raw-t-x.json");
  fs.writeFileSync(partial, '{"pageCont');
  assert.deepEqual(take("t"), []);
  assert.ok(fs.existsSync(partial), "left for the next pass");
  const old = new Date(Date.now() - 10_000);
  fs.utimesSync(partial, old, old);
  assert.deepEqual(take("t"), [null]);
  assert.ok(!fs.existsSync(partial));
});

test("an event that lands in the clock tick of a pass that found nothing is still taken", () => {
  fs.mkdirSync(eventsDir(), { recursive: true });
  const tick = Math.floor(Date.now() / 1000); // a coarse clock: the folder's mtime doesn't move
  fs.utimesSync(eventsDir(), tick, tick);
  assert.deepEqual(take("r"), []);
  posted("r", { n: 1 });
  fs.utimesSync(eventsDir(), tick, tick);
  assert.deepEqual(take("r"), [{ n: 1 }]);
});

test("the watch applies events as they land, until it's told to stop", async () => {
  const seen: unknown[] = [];
  let until = Date.now() + 60_000;
  watch("w", async () => void seen.push(...take("w")), () => until);
  await new Promise((r) => setTimeout(r, 200)); // macOS's watch starts a moment after it's made
  posted("w", { n: 1 });
  for (let i = 0; i < 100 && !seen.length; i++) await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(seen, [{ n: 1 }]);
  until = 0;
});

test("passes for a title run one at a time, whoever asks, and one that fails doesn't stop the next", async () => {
  const seen: string[] = [];
  const pass = (name: string, fail = false) => async () => {
    seen.push(`${name} starts`);
    await new Promise((r) => setTimeout(r, 20));
    seen.push(`${name} ends`);
    if (fail) throw new Error(name);
  };
  const runs = [inTurn("q", pass("a", true)), inTurn("q", pass("b")), inTurn("other", pass("c"))];
  await Promise.allSettled(runs);
  await assert.rejects(runs[0], /a/);
  assert.deepEqual(seen.filter((x) => !x.startsWith("c")), ["a starts", "a ends", "b starts", "b ends"]);
  assert.ok(seen.indexOf("c starts") < seen.indexOf("a ends"), "another title's pass doesn't wait");
});

test("embedded JSON can't end a script or start markup", () => {
  const text = embed({ x: "</script><script>alert(1)</script>&\u2028" });
  assert.ok(!/[<>&\u2028]/.test(text));
  assert.deepEqual(JSON.parse(text), { x: "</script><script>alert(1)</script>&\u2028" });
});

test("the pages' key is kept, and made again once AnythingLLM no longer takes it", async () => {
  const dir = path.join(tmp, "data");
  const first = await pageKey(dir);
  assert.equal(await pageKey(dir), first);
  made.delete(first); // revoked in AnythingLLM's settings
  assert.equal(await pageKey(dir), first, "taken as valid for a few minutes, without asking AnythingLLM");
  delete (globalThis as unknown as Record<symbol, unknown>)[Symbol.for("anythingllm-suite.pages.key-checked")];
  const second = await pageKey(dir);
  assert.notEqual(second, first);
  if (process.platform !== "win32") assert.equal((fs.statSync(path.join(dir, ".page-key.json")).mode & 0o777).toString(8), "600"); // Windows has no modes
});

test("a public file is written where AnythingLLM serves it", () => {
  writePublic("library-lean/x.json", "{}");
  assert.equal(fs.readFileSync(path.join(publicDir(), "library-lean", "x.json"), "utf8"), "{}");
});
