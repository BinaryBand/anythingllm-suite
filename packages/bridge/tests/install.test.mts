import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { readEnv } from "../src/envfile.mts";
import { settingsFile } from "../src/settings.mts";
import { health, install, uninstall, type Ctx } from "../src/install.mts";
import { developerKey } from "../src/pair.mts";
import { unitText } from "../src/service.mts";
import { Upstream } from "../src/upstream.mts";
import { FakeAnythingLLM } from "./fakes/anythingllm.mts";
import { tempDir } from "./fakes/tmp.mts";

const DEFAULT = "/workspaces, GET /scheduled-jobs, GET /workspace/*/threads, POST /workspace/*/thread/new";
const tmp = tempDir("install");

let fake: FakeAnythingLLM;
let home: string;
let storage: string;
let printed: string[];
let ctx: Ctx;

beforeEach(async () => {
  fake = await new FakeAnythingLLM().start();
  home = fs.mkdtempSync(path.join(tmp, "home-"));
  storage = path.join(home, "storage");
  fs.mkdirSync(path.join(storage, "plugins"), { recursive: true });
  fs.writeFileSync(path.join(storage, ".env"), "AUTH_TOKEN='pw'\n");
  fake.replies.set("GET /system/api-keys", { json: { apiKeys: [] } });
  fake.replies.set("POST /system/generate-api-key", { json: { apiKey: { secret: "agent-secret" } } });
  printed = [];
  ctx = {
    home,
    env: { ANYTHINGLLM_URL: fake.url, BRIDGE_PORT: "1" },
    print: (l) => printed.push(l),
    command: ["/usr/bin/node", "/x/bridge.js", "serve"],
    defaultAllow: DEFAULT,
    run: () => ({ status: 1, stdout: "" }), // no systemctl
  };
});
afterEach(() => fake.stop());

const settings = () => settingsFile(home);
const mcpFile = (name: string) => path.join(home, ".config", "anythingllm-mcp", `${name}.env`);
const opts = { agentTools: true, start: false };

test("install points the bridge at the storage and sets BRIDGE_ALLOW when none is", async () => {
  await install(ctx, { ...opts, storage });
  assert.deepEqual(readEnv(settings()), { ANYTHINGLLM_STORAGE: storage, BRIDGE_ALLOW: DEFAULT });
});

test("install makes the developer key once and writes it, mode 600, for the control server", async () => {
  await install(ctx, { ...opts, storage });
  assert.deepEqual(readEnv(mcpFile("control")), { ANYTHINGLLM_DEVELOPER_KEY: "agent-secret", ANYTHINGLLM_BRIDGE_URL: "http://127.0.0.1:1" });
  assert.equal(fs.statSync(mcpFile("control")).mode & 0o777, 0o600);
  assert.ok(!fs.existsSync(mcpFile("chat")) && !fs.existsSync(mcpFile("schedule")), "one file for the one server");
  assert.ok(!printed.join("\n").includes("agent-secret"), "the key is never printed");
  assert.ok(fake.calls.some((c) => c.method === "POST" && c.body && (c.body as { name: string }).name === "anythingllm-mcp"));
});

test("a key or address already in the server's file is the owner's and stays", async () => {
  fs.mkdirSync(path.dirname(mcpFile("control")), { recursive: true });
  fs.writeFileSync(mcpFile("control"), "ANYTHINGLLM_DEVELOPER_KEY=mine\n");
  await install(ctx, { ...opts, storage });
  assert.deepEqual(readEnv(mcpFile("control")), { ANYTHINGLLM_DEVELOPER_KEY: "mine", ANYTHINGLLM_BRIDGE_URL: "http://127.0.0.1:1" });
});

test("--no-agent-tools makes no key and no file", async () => {
  await install(ctx, { ...opts, storage, agentTools: false });
  assert.ok(!fs.existsSync(mcpFile("control")));
  assert.deepEqual(fake.calls, []);
});

test("an owner's BRIDGE_ALLOW stays, empty included, and install names the chat routes it lacks", async () => {
  fs.mkdirSync(path.dirname(settings()), { recursive: true });
  fs.writeFileSync(settings(), "BRIDGE_ALLOW=GET /scheduled-jobs\n");
  await install(ctx, { ...opts, storage });
  assert.equal(readEnv(settings()).BRIDGE_ALLOW, "GET /scheduled-jobs");
  assert.match(printed.join("\n"), /lacks the chat routes.*GET \/workspace\/\*\/threads, POST \/workspace\/\*\/thread\/new/);
  fs.writeFileSync(settings(), "BRIDGE_ALLOW=\n");
  printed.length = 0;
  await install(ctx, { ...opts, storage, agentTools: false });
  assert.equal(readEnv(settings()).BRIDGE_ALLOW, "");
  assert.match(printed.join("\n"), /BRIDGE_ALLOW is empty/);
});

test("a folder that isn't AnythingLLM's storage is refused, and a failing login leaves the rest done", async () => {
  await assert.rejects(install(ctx, { ...opts, storage: home }), { status: 400, message: /doesn't look like AnythingLLM's storage/ });
  fake.password = "changed";
  await install(ctx, { ...opts, storage });
  assert.match(printed.join("\n"), /no developer key made.*Invalid password/);
  assert.equal(readEnv(settings()).ANYTHINGLLM_STORAGE, storage);
});

test("uninstall forgets the storage", async () => {
  await install(ctx, { ...opts, storage, agentTools: false });
  uninstall(ctx);
  assert.equal(readEnv(settings()).ANYTHINGLLM_STORAGE, undefined);
  assert.equal(readEnv(settings()).BRIDGE_ALLOW, DEFAULT);
});

test("health fails when the bridge isn't answering, and says which check", async () => {
  await install(ctx, { ...opts, storage });
  printed.length = 0;
  assert.equal(await health(ctx), false);
  const report = printed.join("\n");
  assert.match(report, /FAIL bridge on :1: no answer/);
  assert.match(report, /ok +AnythingLLM/);
  assert.match(report, /ok +the internal API's login/);
  assert.match(report, /ok +BRIDGE_ALLOW/);
});

test("the named developer key is reused, and made when there is none", async () => {
  const api = new Upstream(fake.url, null);
  fake.replies.set("GET /system/api-keys", { json: { apiKeys: [{ name: "other", secret: "o" }, { name: "AnywhereLLM", secret: "phone" }] } });
  assert.equal(await developerKey(api), "phone");
  assert.equal(fake.calls.length, 1);
  fake.replies.set("GET /system/api-keys", { json: { apiKeys: [] } });
  fake.replies.set("POST /system/generate-api-key", { json: { apiKey: { secret: "new" } } });
  assert.equal(await developerKey(api), "new");
  fake.replies.set("POST /system/generate-api-key", { json: { error: "no" } });
  await assert.rejects(developerKey(api), /made no key: no/);
  fake.replies.set("GET /system/api-keys", { status: 500, json: { error: "boom" } });
  await assert.rejects(developerKey(api), /answered 500: boom/);
});

test("the unit runs the command with the settings file as its environment", () => {
  const text = unitText(["/usr/bin/node", "/opt/my apps/bridge.js", "serve"], "/h/bridge.env", 8467);
  assert.match(text, /^EnvironmentFile=\/h\/bridge\.env$/m);
  assert.match(text, /^ExecStart=\/usr\/bin\/node "\/opt\/my apps\/bridge\.js" serve$/m);
  assert.match(text, /^WantedBy=default\.target$/m);
});
