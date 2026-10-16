import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, test } from "node:test";
import vm from "node:vm";
import { definitionFor, publicDir, root, storage } from "./harness.mts";
import { keyForPages, publish, refresh, render, unpublish } from "../src/page.ts";
import { apply } from "../src/patch.ts";
import * as parts from "../src/parts.ts";
import * as store from "../src/store.ts";

const listPage = () => parts.compose(parts.template("column"), "item-list");
const groceries = (items: unknown[] = [{ text: "Eggs", done: true }, { text: "</script><b>", done: false }]) => ({
  name: "groceries", changed: "2026-10-13T12:00:00Z", line: 4, seen: ["a"], ...definitionFor("list", { title: "Groceries" }), page: listPage(), data: { items },
});
const key = async () => "brx-k";

test("a page is rendered with this skill's stand-in for a server", () => {
  const html = render(groceries(), "home", "https://owen.example:3001/", "brx-test")!;
  const lean = JSON.parse(html.match(/<script id="apps-lean" type="application\/json">(.*?)<\/script>/)![1]);
  assert.deepEqual([lean.workspace, lean.app, lean.base, lean.key, lean.line, lean.seen], ["home", "groceries", "https://owen.example:3001", "brx-test", 4, ["a"]]);
  assert.equal(lean.data.items[1].text, "</script><b>");
  assert.ok(html.includes("App.start(AppsLean.app())"));
  const outside = html.replace(/<script[^>]*>[\s\S]*?<\/script>|<style>[\s\S]*?<\/style>/g, "");
  assert.ok(!outside.includes('src="app.js"') && !outside.includes('href="app.css"'), "every library is inline");
  assert.ok(html.indexOf("var AppsLean") < html.indexOf("const App = (() =>"), "the stand-in comes before the runtime");
  // The app's data, the stand-in, app.js, the template's script and item-list's: no inlined text
  // ends a script early.
  assert.equal(html.split("</script>").length - 1, 5);
  assert.equal(render({ ...groceries(), page: undefined }, "home", "https://x", "k"), null, "an app with no page has none to render");
});

test("pages share one key, kept beside the apps for the owner alone", async () => {
  const first = await keyForPages();
  assert.match(first, /^brx-test-\d+$/);
  assert.equal(await keyForPages(), first);
  if (process.platform !== "win32") assert.equal(fs.statSync(path.join(root, ".page-key.json")).mode & 0o777, 0o600);
});

test("a page is published at one random address, rewritten and removed", async () => {
  await store.create("home", "shop", definitionFor("list", { title: "Shop" }), undefined);
  await store.writeFile("home", "shop", "page.html", listPage());
  const url = await publish(store.read("home", "shop"), "home", "https://owen.example:3001/", key);
  const token = store.read("home", "shop").pageToken;
  assert.equal(url, `https://owen.example:3001/apps-lean/${token}.html`);
  const file = path.join(publicDir, "apps-lean", `${token}.html`);
  assert.ok(!fs.existsSync(path.join(publicDir, "_apps")), "no font beside it: pages use the system's own");
  await store.change("home", "shop", { patch: [{ op: "add", path: "/items/-", value: { text: "Tea", done: false } }] });
  await refresh("home", "shop", "https://owen.example:3001", key);
  assert.match(fs.readFileSync(file, "utf8"), /"text":"Tea"/);
  assert.equal(await publish(store.read("home", "shop"), "home", "https://owen.example:3001", key), url, "the address stays");
  unpublish(store.read("home", "shop"));
  assert.ok(!fs.existsSync(file));
});

test("where the public folder can't be written there is no address", async () => {
  const blocker = path.join(storage, "blocker");
  fs.mkdirSync(storage, { recursive: true });
  fs.writeFileSync(blocker, "");
  const was = process.env.ANYTHINGLLM_PUBLIC_DIR;
  process.env.ANYTHINGLLM_PUBLIC_DIR = path.join(blocker, "public");
  try {
    await store.create("home", "nowhere", { ...definitionFor("list", { title: "Nowhere" }), page: listPage() }, undefined);
    assert.equal(await publish(store.read("home", "nowhere"), "home", "https://x", key), null);
    assert.equal(store.read("home", "nowhere").pageToken, undefined);
  } finally {
    process.env.ANYTHINGLLM_PUBLIC_DIR = was;
  }
});

const browsers: (() => void)[] = [];
afterEach(() => browsers.splice(0).forEach((close) => close()));

/** Runs a rendered page's scripts (the stand-in and app.js) against a small stand-in for a browser,
 *  with `served` as what fetching the page itself gives. */
function browser(html: string, { stored = null, served = () => html }: { stored?: unknown; served?: () => string } = {}) {
  const lean = html.match(/<script id="apps-lean" type="application\/json">(.*?)<\/script>/)![1];
  const scripts = parts.scriptsOf(html);
  const posted: any[] = [];
  const storage = { v: (stored ? JSON.stringify(stored) : null) as string | null, getItem() { return this.v; }, setItem(_k: string, v: string) { this.v = v; } };
  const fetch = async (url: string, opts: any) => {
    if (url === "https://x/p.html") return new Response(served());
    posted.push(JSON.parse(JSON.parse(opts.body).textContent));
    return new Response("{}", { status: 200 });
  };
  let open = true;
  const ctx: any = {
    console, JSON, Response, Promise, Object, Math, Date, Array, Error, URLSearchParams,
    // Fast, and none once closed, so the runtime's sync loop stops with the test.
    setTimeout: (fn: () => void, ms: number) => (open ? setTimeout(fn, Math.min(ms, 20)) : 0), clearTimeout,
    localStorage: storage, location: { protocol: "https:", href: "https://x/p.html", search: "" },
    document: { getElementById: (id: string) => (id === "apps-lean" ? { textContent: lean } : null), addEventListener() {}, removeEventListener() {}, visibilityState: "visible", hidden: false },
    fetch,
  };
  ctx.window = ctx;
  ctx.self = ctx;
  vm.createContext(ctx);
  // The stand-in, then app.js; the app is started as the template does, with what changed seen.
  vm.runInContext(scripts[0] + "\n" + scripts[1].replace("const App =", "var App ="), ctx);
  vm.runInContext("var changes = []; App.start(AppsLean.app()); App.onchange((d) => changes.push(JSON.parse(JSON.stringify(d))));", ctx);
  const close = () => void (open = false);
  browsers.push(close);
  return { ctx, posted, storage, close };
}
/** A value from inside the stand-in browser, as plain JSON. */
const value = (ctx: any, expr: string) => JSON.parse(vm.runInContext(`JSON.stringify(${expr})`, ctx));
const settle = (ms = 120) => new Promise((go) => setTimeout(go, ms));

test("the page runtime saves through the stand-in: a change becomes an AnythingLLM event", async () => {
  const html = render(groceries([{ text: "Eggs", done: false }]), "home", "https://x", "brx-k")!;
  const { ctx, posted, storage, close } = browser(html);
  const saved = await vm.runInContext(`App.patch([{op: "test", path: "/items/0/text", value: "Eggs"}, {op: "replace", path: "/items/0/done", value: true}], {ev: "tick", text: "Eggs"})`, ctx);
  await settle();
  assert.equal(saved, true);
  assert.deepEqual(posted.map((e) => [e.apps_lean_event, e.workspace, e.app, e.ev, e.fields]), [[1, "home", "groceries", "tick", { text: "Eggs" }]]);
  assert.equal(value(ctx, "App.data.items[0].done"), true);
  assert.deepEqual(JSON.parse(storage.v!).pending.map((e: any) => e.id), [posted[0].id], "kept until the app records it");
  close();
});

test("a rewritten page's data arrives under this page's unrecorded changes; recorded ones go", async () => {
  const first = groceries([{ text: "Eggs", done: false }, { text: "Jam", done: false }]);
  let served = render(first, "home", "https://x", "brx-k")!;
  const { ctx, storage, close } = browser(served, {
    served: () => served,
    stored: { pending: [{ id: "mine", patch: [{ op: "test", path: "/items/1/text", value: "Jam" }, { op: "replace", path: "/items/1/done", value: true }] }] },
  });
  assert.deepEqual(value(ctx, "App.data.items.map((i) => i.done)"), [false, true], "an unrecorded change shows over the page's data");
  // The agent adds Tea elsewhere, and the skill writes the page again.
  served = render({ ...first, changed: "2026-10-13T12:05:00Z", line: 5, data: { items: [...first.data.items, { text: "Tea", done: false }] } }, "home", "https://x", "brx-k")!;
  await settle(300);
  assert.deepEqual(value(ctx, "App.data.items.map((i) => [i.text, i.done])"), [["Eggs", false], ["Jam", true], ["Tea", false]]);
  // Then the app records this page's change.
  served = render({ ...first, changed: "2026-10-13T12:06:00Z", line: 6, seen: ["a", "mine"], data: { items: [{ text: "Eggs", done: false }, { text: "Jam", done: true }, { text: "Tea", done: false }] } }, "home", "https://x", "brx-k")!;
  await settle(300);
  assert.deepEqual(JSON.parse(storage.v!).pending, []);
  assert.deepEqual(value(ctx, "App.data.items.map((i) => i.done)"), [false, true, false]);
  close();
});

test("App.log gives the newest changes the page was written with, at once", async () => {
  const app = {
    ...groceries([{ text: "Eggs", done: true }]),
    line: 7,
    history: [
      { t: "2026-10-13T12:00:00Z", by: "agent", ev: "add", fields: { text: "Eggs" }, patch: [{ op: "add", path: "/items/-", value: { text: "Eggs", done: false } }], before: { items: [] } },
      { t: "2026-10-13T12:01:00Z", by: "page", ev: "tick", fields: { text: "Eggs" }, patch: [{ op: "replace", path: "/items/0/done", value: true }], before: { items: [{ text: "Eggs", done: false }] } },
    ],
  };
  const { ctx } = browser(render(app, "home", "https://x", "brx-k")!);
  const lines = await vm.runInContext("App.log(6).then((l) => JSON.stringify(l))", ctx);
  assert.deepEqual(JSON.parse(lines), [{ n: 7, t: "2026-10-13T12:01:00Z", by: "page", ev: "tick", text: "Eggs", patch: [{ op: "replace", path: "/items/0/done", value: true }] }]);
});

test("the page patches with one engine, and it agrees with the skill's patch.ts", () => {
  const { ctx, close } = browser(render(groceries([]), "home", "https://x", "brx-k")!);
  const doc = { items: [{ text: "Eggs", done: false }, { text: "Jam", done: true }], meta: { tags: ["a", "b"], "a/b": 1, "m~n": 2 } };
  const cases = [
    [{ op: "add", path: "/items/-", value: { text: "Tea", done: false } }],
    [{ op: "add", path: "/items/0", value: { text: "First", done: false } }],
    [{ op: "replace", path: "/items/1/done", value: false }],
    [{ op: "remove", path: "/items/0" }],
    [{ op: "move", from: "/items/0", path: "/items/1" }],
    [{ op: "copy", from: "/items/0", path: "/items/-" }],
    [{ op: "test", path: "/items/0/text", value: "Eggs" }, { op: "replace", path: "/items/0/done", value: true }],
    [{ op: "replace", path: "/meta/a~1b", value: 5 }, { op: "replace", path: "/meta/m~0n", value: 6 }],
    [{ op: "add", path: "/meta/tags/1", value: "x" }],
    [{ op: "replace", path: "", value: { items: [] } }],
    // Each of these is refused, by both.
    [{ op: "test", path: "/items/0/text", value: "Milk" }],
    [{ op: "remove", path: "/items/2" }],
    [{ op: "remove", path: "/items/01" }],
    [{ op: "add", path: "/items/3", value: 1 }],
    [{ op: "replace", path: "/nope", value: 1 }],
    [{ op: "move", from: "/items", path: "/items/0/inside" }],
    [{ op: "frobnicate", path: "/items" }],
  ];
  for (const patch of cases) {
    const here = (() => {
      try {
        return { value: apply(doc, patch) };
      } catch {
        return { refused: true };
      }
    })();
    const there = JSON.parse(
      vm.runInContext(`(() => { try { return JSON.stringify({ value: App.apply(${JSON.stringify(doc)}, ${JSON.stringify(patch)}) }); } catch (e) { return JSON.stringify({ refused: true }); } })()`, ctx),
    );
    assert.deepEqual(there, here, JSON.stringify(patch));
  }
  close();
});
