// Run inside a started stock AnythingLLM container, by hand (see the skill's notes): loads the skill
// through AnythingLLM's own loader (ImportedPlugin), sets it up on a stand-in agent as AnythingLLM's
// agent would, and drives it against the real server: a page published into AnythingLLM's public
// folder and served by AnythingLLM itself, with its state file; a tap posted to the real
// browser-extension upload, written by the real collector and applied by the skill's folder watch
// with no call; an event without the app's secret refused; the page check in its worker on the
// image's own Node; a delete that leaves its page saying so. Prints "ok" or throws.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { HUB_ID, STORAGE_DIR } = process.env;
const APP = "/app/server";
const SERVER = `http://127.0.0.1:${process.env.INNER_PORT || 3001}`;
const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
/** The link a card gives to the page of the app titled `title`, with the address as group 1. */
const linkTo = (title) => new RegExp(String.raw`\*\*\[${title}\]\((${escaped(SERVER)}/${HUB_ID}/[A-Za-z0-9_-]+\.html)\)`);
const ImportedPlugin = require(`${APP}/utils/agents/imported.js`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  assert.ok(ImportedPlugin.validateImportedPluginHandler(HUB_ID), "the handler is where AnythingLLM looks");
  const active = JSON.stringify(ImportedPlugin.activeImportedPlugins());
  assert.ok(active.includes(HUB_ID), `AnythingLLM lists the skill as active: ${active}`);

  const plugin = ImportedPlugin.loadPluginByHubId(HUB_ID).plugin({ ANYTHINGLLM_URL: SERVER });
  const asked = [];
  const call = async (slug, args, approve = true) => {
    let fn;
    const agent = {
      handlerProps: { invocation: { workspace: { slug } }, log: () => {} },
      introspect: () => {},
      function: (def) => (fn = def),
      socket: { send: () => {} },
      requestToolApproval: async (q) => (asked.push(q), { approved: approve, message: "" }),
    };
    plugin.setup(agent);
    assert.equal(fn.name, HUB_ID);
    return fn.handler.call(fn, args);
  };

  // A starter: the app and its page in one call, the page published as it is made.
  const made = await call("home", { action: "create", name: "groceries", title: "Groceries", starter: "checklist" });
  const link = made.match(linkTo("Groceries"));
  assert.ok(link, `create gave a link: ${made.split("\n").slice(0, 3).join(" / ")}`);
  const url = link[1];
  const stateUrl = url.replace(/\.html$/, ".json");
  const page = await fetch(url);
  assert.equal(page.status, 200, "AnythingLLM serves the page");
  assert.match(page.headers.get("content-type"), /^text\/html/);
  const cfg = JSON.parse((await page.text()).match(/<script id="apps-lean" type="application\/json">(.*?)<\/script>/)[1]);
  assert.ok(cfg.key.startsWith("brx-"), "the pages' key is a browser-extension key AnythingLLM made");
  assert.ok(cfg.secret && !("base" in cfg), "the page has its app's secret, and no address of AnythingLLM's");
  const state = async () => (await fetch(stateUrl, { cache: "no-store" })).json();
  assert.deepEqual(Object.keys(await state()).sort(), ["data", "line", "seen", "version"]);

  assert.match(await call("home", { action: "do", name: "groceries", ev: "add", patch: [{ op: "add", path: "/items/-", value: { text: "Bread", done: false } }] }), /\| ☐ \| Bread \|/);
  assert.match(await call("work", { action: "list" }), /^This workspace has no apps yet\./);

  // A tap, posted as the page posts it, twice (a page may send one again), and one claiming the app
  // without its secret; the watch the calls started applies them as the collector writes them.
  const post = (event) =>
    fetch(SERVER + "/api/browser-extension/upload-content", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + cfg.key },
      body: JSON.stringify({ textContent: JSON.stringify(event), metadata: { title: cfg.eventTitle, docSource: "apps-lean page" } }),
    });
  const tap = { apps_lean_event: 1, workspace: "home", app: "groceries", secret: cfg.secret, id: "tap-1", ev: "tick", fields: { text: "Bread" }, patch: [{ op: "test", path: "/items/0/text", value: "Bread" }, { op: "replace", path: "/items/0/done", value: true }] };
  for (let i = 0; i < 2; i++) assert.equal((await post(tap)).status, 200, "AnythingLLM takes the page's event");
  assert.equal((await post({ ...tap, secret: "not-its-own", id: "tap-2", ev: "untick", patch: [{ op: "replace", path: "/items/0/done", value: false }] })).status, 200);
  const until = Date.now() + 40_000; // the watch, or its 30 s poll where a folder watch sees nothing
  while (Date.now() < until && !(await state()).seen.includes("tap-1")) await sleep(200);
  const after = await state();
  assert.deepEqual(after.data.items.map((i) => [i.text, i.done]), [["Bread", true]], "the tap reached the app and its state file with no call");
  await sleep(1000);
  const listed = await call("home", { action: "list" });
  assert.match(listed, /Changes made on app pages since the last call[^\n]*\n- tick Bread on groceries\n\n/, listed);
  assert.match(listed, /0 of 1 left/, "the untick without the app's secret was refused");
  const saved = JSON.parse(fs.readFileSync(path.join(STORAGE_DIR, HUB_ID, "home", "groceries.json"), "utf8"));
  assert.equal(saved.history.filter((h) => h.by === "page").length, 1, "the tap sent twice applies once");

  // The page check, in its worker on this Node.
  const refused = await call("home", { action: "edit", name: "groceries", file: "page.html", find: "<!--scripts-->", text: "<script>App.onchange(draw);</script>\n<!--scripts-->" });
  assert.match(refused, /page\.html uses draw, which no script declares/);

  assert.equal(await call("home", { action: "delete", name: "groceries" }, false), "The user kept groceries.");
  assert.match(asked[0].description, /Delete the app Groceries/);
  assert.match(await call("home", { action: "delete", name: "groceries" }), /^Deleted the app groceries, its changes and its page\./);
  assert.deepEqual(await state(), { gone: true }, "a page still open is told");
  assert.ok(!fs.existsSync(path.join(APP, "public", HUB_ID, url.split("/").pop())), "the page is gone");
  assert.match(await call("home", { action: "guide" }), /^# Apps/);
  console.log("ok");
  process.exit(0);
})().catch((e) => {
  console.error(e.stack || e);
  process.exit(1);
});
