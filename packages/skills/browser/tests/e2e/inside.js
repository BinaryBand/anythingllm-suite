// Run inside a stock AnythingLLM container (by hand: see docs/notes/skills/browser): loads the skill
// through AnythingLLM's own loader (ImportedPlugin), sets it up on a stand-in agent as AnythingLLM's
// agent would, and drives the real Chrome of the collector's Puppeteer against a site this script
// serves on 127.0.0.1 and localhost (FENCE_ALLOW lets them through): open and read a page, act on it, sign in with
// the password given on the tab's page (sealed with the vault's key, posted as AnythingLLM's
// collector writes it), and search and look at a stand-in search page.
// Prints "ok" or throws.
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { HUB_ID } = process.env;
const APP = "/app/server";
const PORT = 18090;
const SITE = `http://127.0.0.1:${PORT}`;
/** The same server under another name, for a search result that isn't on the engine's own site. */
const DOCS = `http://localhost:${PORT}/docs`;

const ImportedPlugin = require(`${APP}/utils/agents/imported.js`);

const page = (title, body) => `<!doctype html><title>${title}</title><body>${body}</body>`;
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    res.setHeader("Content-Type", "text/html");
    const url = new URL(req.url, SITE);
    if (url.pathname === "/login" && req.method === "POST") {
      const form = new URLSearchParams(body);
      if (form.get("user") === "ada" && form.get("pass") === "e2e-pass-123") return res.end(page("Home", "<p>Welcome, ada.</p>"));
      return res.end(page("Sign in", "<p>Wrong password.</p>"));
    }
    if (url.pathname === "/login") return res.end(page("Sign in", '<form method="post" action="/login"><label>User <input name="user"></label><label>Password <input name="pass" type="password"></label><button>Sign in</button></form>'));
    if (url.pathname === "/search") return res.end(page("Search", `<div><a href="${SITE}/go?u=${encodeURIComponent(DOCS)}">Docs for ${url.searchParams.get("q")}</a> The docs</div>`));
    if (url.pathname === "/docs") return res.end(page("Docs", "<h1>Docs</h1><p>The export button is under Settings.</p>"));
    res.statusCode = 404;
    res.end(page("Not found", ""));
  });
});

(async () => {
  await new Promise((r) => server.listen(PORT, r));
  assert.ok(ImportedPlugin.validateImportedPluginHandler(HUB_ID), "the handler is where AnythingLLM looks");
  const plugin = ImportedPlugin.loadPluginByHubId(HUB_ID).plugin({ SEARCH_URL: `${SITE}/search?q={q}` });
  const call = async (args) => {
    let fn;
    const agent = { handlerProps: { invocation: { workspace: { slug: "e2e" }, thread_id: 7 }, log: (m) => console.error(m) }, introspect: () => {}, function: (def) => (fn = def) };
    plugin.setup(agent);
    assert.equal(fn.name, HUB_ID);
    return fn.handler.call(fn, args);
  };

  const opened = await call({ action: "open", url: `${SITE}/login` });
  assert.match(opened, /Page: Sign in/, opened);
  const ref = (label) => opened.match(new RegExp(`\\[(e\\d+)\\] ${label}`))[1];
  const [user, pass, submit] = [ref('input\\[text\\] "User'), ref('input\\[password\\] "Password'), ref('button "Sign in"')];
  assert.match(opened, /\[!\[Sign in\]\(\/browser-lean\/[\w-]+-card\.jpg\?v=\w+\)\]\(\/browser-lean\/[\w-]+\.html\)/, "the card");

  assert.match(await call({ action: "act", do: "fill", ref: pass, text: "nope" }), /password field, which act never types into/);
  assert.match(await call({ action: "login", user_ref: user, pass_ref: pass, submit_ref: submit }), /The user is asked on the tab's page/);

  const storage = process.env.STORAGE_DIR || `${APP}/storage`;
  const { token } = JSON.parse(fs.readFileSync(`${storage}/browser-lean/e2e/tabs.json`, "utf8"))["7"];
  const cfg = JSON.parse(fs.readFileSync(`${APP}/public/browser-lean/${token}.html`, "utf8").match(/const cfg = (\{.*?\});/)[1]);
  assert.equal(JSON.parse(fs.readFileSync(`${APP}/public/browser-lean/${token}.json`, "utf8")).need.kind, "login");
  const pub = crypto.createPublicKey({ key: Buffer.from(cfg.pub, "base64"), format: "der", type: "spki" });
  const sealed = crypto.publicEncrypt({ key: pub, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, Buffer.from("e2e-pass-123")).toString("base64");
  const events = `${storage}/documents/custom-documents`;
  fs.mkdirSync(events, { recursive: true });
  const event = { browser_lean_event: 1, workspace: "e2e", tab: "7", secret: cfg.secret, ev: "need-answer", user: "ada", sealed, save: true };
  fs.writeFileSync(path.join(events, `raw-${cfg.title}-${crypto.randomUUID()}.json`), JSON.stringify({ pageContent: JSON.stringify(event) }));
  const signedIn = await call({ action: "read" });
  assert.match(signedIn, /Page: Home/, signedIn);
  assert.match(signedIn, /Welcome, ada\./, "a username isn't a secret: only the password is hidden");
  assert.match(signedIn, /the login the user entered was saved for 127\.0\.0\.1, for next time/, "saved once the page no longer asks for a password");

  const found = await call({ action: "search", query: "export" });
  assert.match(found, /1\. Docs for export\n {3}http:\/\/localhost:\d+\/docs/, found);
  assert.match(await call({ action: "look", url: DOCS, find: "export" }), /The export button is under Settings\./);
  assert.match(await call({ action: "open", url: "http://10.1.2.3/" }), /isn't a public address/);

  server.close();
  console.log("ok");
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
