// Run inside a stock AnythingLLM container by tools/check: loads the skill through AnythingLLM's
// own loader (ImportedPlugin), sets it up on a stand-in agent as AnythingLLM's agent would, and
// keeps, finds, rewrites and forgets facts in AnythingLLM's own LanceDB, embedded by its own
// generic OpenAI embedder pointed at a stand-in this script serves on 127.0.0.1 (words hashed
// into a vector, so texts that share words are close). Then it drops the namespace as a vector
// database reset would, and changes the embedder, and the facts are found again.
// Prints "ok" or throws.
const assert = require("assert");
const http = require("http");
const { HUB_ID } = process.env; // from tools/check
const APP = "/app/server";
const PORT = 18082;

process.env.EMBEDDING_ENGINE = "generic-openai";
process.env.EMBEDDING_BASE_PATH = `http://127.0.0.1:${PORT}/v1`;
process.env.EMBEDDING_MODEL_PREF = "e2e-words";
process.env.GENERIC_OPEN_AI_EMBEDDING_API_KEY = "e2e-key";
delete process.env.VECTOR_DB; // AnythingLLM's default, LanceDB

const ImportedPlugin = require(`${APP}/utils/agents/imported.js`);
const { getVectorDbClass } = require(`${APP}/utils/helpers`);
const { DocumentVectors } = require(`${APP}/models/vectors`);

// The same words-into-a-vector as the unit tests' stand-in (fixtures/server/utils/helpers).
const DIMS = 64;
const asked = [];
function embed(text) {
  const v = new Array(DIMS).fill(0);
  for (const word of String(text).toLowerCase().match(/[a-z0-9]{2,}/g) || []) {
    let h = 2166136261;
    for (const c of word) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
    v[h % DIMS] += 1;
  }
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    assert.equal(req.url, "/v1/embeddings");
    assert.equal(req.headers.authorization, "Bearer e2e-key");
    const sent = JSON.parse(body);
    const inputs = Array.isArray(sent.input) ? sent.input : [sent.input];
    asked.push({ model: sent.model, inputs });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ object: "list", model: sent.model, data: inputs.map((t, index) => ({ object: "embedding", index, embedding: embed(t) })), usage: { prompt_tokens: 1, total_tokens: 1 } }));
  });
});

(async () => {
  await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
  assert.ok(ImportedPlugin.validateImportedPluginHandler(HUB_ID), "the handler is where AnythingLLM looks");
  assert.ok(JSON.stringify(ImportedPlugin.activeImportedPlugins()).includes(HUB_ID), "AnythingLLM lists the skill as active");
  const plugin = ImportedPlugin.loadPluginByHubId(HUB_ID).plugin({});
  const call = async (args, slug = "check") => {
    let fn;
    const agent = {
      handlerProps: { invocation: { workspace: { slug }, thread_id: 1 }, log: (m) => console.error(m) },
      introspect: () => {},
      function: (def) => (fn = def),
    };
    plugin.setup(agent);
    assert.equal(fn.name, HUB_ID);
    return fn.handler.call(fn, args);
  };

  assert.match(await call({ action: "remember", text: "Takes coffee black.", kind: "preference" }), /^Remembered: m1 \(global, preference\)/);
  assert.match(await call({ action: "remember", text: "Project Atlas ships in March.", scope: "workspace" }), /^Remembered: m2 \(workspace, other\)/);
  assert.ok(asked.some((a) => a.model === "e2e-words" && a.inputs.some((t) => t.includes("Takes coffee black."))), "AnythingLLM's embedder embedded the fact");

  const db = getVectorDbClass();
  const { client } = await db.connect();
  assert.ok((await client.tableNames()).includes("memory-lean-g"), "the facts are in LanceDB, in a namespace of their own");
  assert.ok((await client.tableNames()).includes("memory-lean-w-check"));
  assert.equal((await DocumentVectors.where({ docId: "memory-lean:m1-1" })).length, 1, "and AnythingLLM records the vectors");

  assert.match(await call({ action: "recall", query: "coffee" }), /m1 \[0\.\d\d\] \(global, preference\) Takes coffee black\./);
  assert.match(await call({ action: "recall", query: "Atlas ships" }), /m2 \[/);
  assert.doesNotMatch(await call({ action: "recall", query: "Atlas ships" }, "elsewhere"), /Project Atlas/, "another workspace sees only the global facts");

  assert.match(await call({ action: "update", id: "m1", text: "Drinks oat milk lattes." }), /^Would change m1/);
  assert.match(await call({ action: "update", id: "m1", text: "Drinks oat milk lattes.", apply: true }), /^Updated: m1/);
  assert.match(await call({ action: "recall", query: "lattes" }), /m1 \[0\.\d\d\] .* Drinks oat milk lattes\./);
  assert.doesNotMatch(await call({ action: "recall", query: "coffee black" }), /Takes coffee black/);
  assert.equal((await DocumentVectors.where({ docId: "memory-lean:m1-1" })).length, 0, "the old text's record is gone");
  assert.equal((await DocumentVectors.where({ docId: "memory-lean:m1-2" })).length, 1);

  // A vector database reset, as AnythingLLM does it for workspaces: the namespace is gone.
  await db["delete-namespace"]({ namespace: "memory-lean-g" });
  assert.match(await call({ action: "recall", query: "lattes" }), /m1 \[/, "made again from the index");
  assert.equal((await DocumentVectors.where({ docId: "memory-lean:m1-2" })).length, 1, "with one record of its vectors, not two");

  // A changed embedder: AnythingLLM drops the vectors; the skill embeds every fact again.
  process.env.EMBEDDING_MODEL_PREF = "e2e-words-2";
  asked.length = 0;
  assert.match(await call({ action: "recall", query: "Atlas ships" }), /m2 \[/);
  assert.ok(asked.some((a) => a.model === "e2e-words-2" && a.inputs.some((t) => t.includes("Project Atlas ships in March."))), "every fact was embedded again, with the new model");

  assert.match(await call({ action: "forget", id: "m2", apply: true }), /^Forgot: m2/);
  assert.match(await call({ action: "list" }), /^1 fact remembered:\nm1 /);
  assert.equal((await DocumentVectors.where({ docId: "memory-lean:m2-1" })).length, 0);

  server.close();
  console.log("ok");
  process.exit(0);
})().catch((e) => {
  console.error(e?.stack || e);
  process.exit(1);
});
