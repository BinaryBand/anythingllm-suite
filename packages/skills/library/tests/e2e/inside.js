// Run inside a stock AnythingLLM container (tools/check, or by hand: see the skill's notes): loads the
// skill through AnythingLLM's own loader (ImportedPlugin), sets it up on a stand-in agent as
// AnythingLLM's agent would, and builds a toolkit for a stand-in API this script serves on
// 127.0.0.1 (FENCE_ALLOW lets it through): the key is asked for on the Library page and given there
// (posted as AnythingLLM's collector writes it), never on a question card; a function is saved and
// tested in QuickJS on the image's own Node, a flow runs another, and a run with no workspace (as a
// scheduled job's) is recorded as one.
// Prints "ok" or throws.
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { HUB_ID } = process.env;
const APP = "/app/server";
const PORT = 18083;
const KEY = "e2e-key-0123456789";

const ImportedPlugin = require(`${APP}/utils/agents/imported.js`);

const server = http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.headers.authorization !== `Bearer ${KEY}`) return ((res.statusCode = 401), res.end('{"message":"no key"}'));
  if (req.url.startsWith("/tasks")) return res.end(JSON.stringify([{ id: 1, title: "Water the plants", done: false }, { id: 2, title: "File taxes", done: true }]));
  res.statusCode = 404;
  res.end("{}");
});

(async () => {
  await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
  assert.ok(ImportedPlugin.validateImportedPluginHandler(HUB_ID), "the handler is where AnythingLLM looks");
  assert.ok(JSON.stringify(ImportedPlugin.activeImportedPlugins()).includes(HUB_ID), "AnythingLLM lists the skill as active");
  const plugin = ImportedPlugin.loadPluginByHubId(HUB_ID).plugin({});
  const cards = [];
  const call = async (args, slug = "check") => {
    let fn;
    const agent = {
      handlerProps: { invocation: { workspace: slug ? { slug } : null, thread_id: 1 }, log: (m) => console.error(m) },
      requestUserClarification: async (q) => (cards.push(q), { skipped: true }),
      addClarifyingQuestionSurvey: () => {},
      function: (def) => (fn = def),
    };
    plugin.setup(agent);
    assert.equal(fn.name, HUB_ID);
    return fn.handler.call(fn, args);
  };

  assert.match(await call({ action: "guide" }), /The library is the user's own set of API toolkits/);
  assert.match(await call({ action: "secret", site: "127.0.0.1", label: "tasks" }), /^The user gives the key on the Library page: \/library-lean\/[\w-]+\.html\n/);
  assert.equal(cards.length, 0, "never on a question card, which shows its answers in the chat");
  const storage = process.env.STORAGE_DIR || `${APP}/storage`;
  const { token, secret } = JSON.parse(fs.readFileSync(`${storage}/library-lean/page.json`, "utf8"));
  const cfg = JSON.parse(fs.readFileSync(`${APP}/public/library-lean/${token}.html`, "utf8").match(/const cfg = (\{.*?\});/)[1]);
  const pub = crypto.createPublicKey({ key: Buffer.from(cfg.pub, "base64"), format: "der", type: "spki" });
  const sealed = crypto.publicEncrypt({ key: pub, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, Buffer.from(KEY)).toString("base64");
  const events = `${storage}/documents/custom-documents`;
  fs.mkdirSync(events, { recursive: true });
  fs.writeFileSync(path.join(events, `raw-${cfg.title}-${crypto.randomUUID()}.json`), JSON.stringify({ pageContent: JSON.stringify({ library_lean_event: 1, secret, ev: "key-save", label: "tasks", site: "127.0.0.1", sealed }) }));
  assert.match(await call({ action: "library" }), /The Library page/);

  const toolkit = { title: "Tasks", base_urls: [`http://127.0.0.1:${PORT}`], secrets: [{ label: "tasks", as: "bearer" }] };
  const open = { name: "open", description: "The tasks not done yet.", source: "async function main(i, kit) { const a = await kit.http({ path: '/tasks' }); return a.body.filter((t) => !t.done).map((t) => t.title); }" };
  const saved = await call({ action: "save", service: "tasks", toolkit, function: open, test: {} });
  assert.match(saved, /Saved tasks\.open, version 1/);
  assert.match(saved, /: ok, .*1 request/);
  assert.match(saved, /"Water the plants"/);
  assert.ok(!saved.includes("File taxes"));

  await call({ action: "save", service: "digest", toolkit: { base_urls: [`http://127.0.0.1:${PORT}`] }, function: { name: "count", description: "How many tasks are open.", source: "async function main(i, kit) { return { open: (await kit.run('tasks.open', {})).length }; }" } });
  assert.match(await call({ action: "run", name: "digest.count" }), /"open": 1/);

  const job = await call({ action: "run", name: "tasks.open" }, null);
  assert.match(job, /: ok, /);
  assert.match(await call({ action: "library" }), /- tasks\.open: ok, \d+ s ago, from a scheduled job/);
  assert.ok(!(await call({ action: "call", url: `http://127.0.0.1:${PORT}/tasks`, auth: "bearer" })).includes(KEY));

  server.close();
  console.log("ok");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
