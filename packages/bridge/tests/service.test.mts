// The systemd side of install, uninstall and health, with `systemctl` scripted and a real bridge
// answering on the port the service would listen on.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { parseRules } from "../src/allow.mts";
import { readEnv } from "../src/envfile.mts";
import { health, install, uninstall, type Ctx } from "../src/install.mts";
import { createServer } from "../src/server.mts";
import { UNIT, unitFile, unitText, usable, type Run } from "../src/service.mts";
import { settingsFile } from "../src/settings.mts";
import { Upstream } from "../src/upstream.mts";
import { close, listen } from "./fakes/net.mts";
import { tempDir } from "./fakes/tmp.mts";

const tmp = tempDir("service");

/** A `systemctl` that answers `running` to is-system-running and 0 to the rest, unless `answers`
 *  (by the arguments, space-joined) says otherwise. Every call is kept, as its arguments. */
function systemctl(answers: Record<string, { status: number; stdout?: string }> = {}) {
  const calls: string[] = [];
  const run: Run = (_, args) => {
    const key = args.join(" ");
    calls.push(key);
    const answer = answers[key] ?? (key === "--user is-system-running" ? { status: 0, stdout: "running\n" } : { status: 0, stdout: "" });
    return { status: answer.status, stdout: answer.stdout ?? "" };
  };
  return { calls, run };
}

let bridge: http.Server;
let port: number;
let home: string;
let storage: string;
let printed: string[];

const ctxWith = (run: Run, env: Record<string, string> = {}): Ctx => ({
  home,
  env: { BRIDGE_PORT: String(port), ...env },
  print: (l) => printed.push(l),
  command: ["/usr/bin/node", "/opt/my apps/bridge.js", "serve"],
  defaultAllow: "/workspaces",
  run,
  startWait: 1,
});
const opts = () => ({ storage, agentTools: false, start: true });

beforeEach(async () => {
  bridge = createServer({ rules: parseRules(""), upstream: new Upstream("http://127.0.0.1:1", null), log: () => {} });
  port = await listen(bridge);
  home = fs.mkdtempSync(path.join(tmp, "home-"));
  storage = path.join(home, "storage");
  fs.mkdirSync(path.join(storage, "plugins"), { recursive: true });
  printed = [];
});
afterEach(() => close(bridge));

test("install writes the unit, then reloads, enables and restarts, in that order", async () => {
  const sc = systemctl();
  const ctx = ctxWith(sc.run);
  await install(ctx, opts());
  assert.equal(fs.readFileSync(unitFile(home), "utf8"), unitText(ctx.command, settingsFile(home), port));
  assert.deepEqual(sc.calls, ["--user is-system-running", "--user daemon-reload", `--user enable ${UNIT}`, `--user restart ${UNIT}`]);
  assert.ok(printed.includes(`wrote the runner's service: ${UNIT}`));
  assert.equal(readEnv(settingsFile(home)).ANYTHINGLLM_STORAGE, storage);
});

test("a second install with the same unit restarts without reloading", async () => {
  await install(ctxWith(systemctl().run), opts());
  const sc = systemctl();
  await install(ctxWith(sc.run), opts());
  assert.deepEqual(sc.calls, ["--user is-system-running", `--user enable ${UNIT}`, `--user restart ${UNIT}`]);
});

test("a restart systemctl refuses is an error that points at the journal", async () => {
  const sc = systemctl({ [`--user restart ${UNIT}`]: { status: 1 } });
  await assert.rejects(install(ctxWith(sc.run), opts()), /systemctl restart .* failed; see `journalctl --user -u anythingllm-bridge\.service`/);
});

test("a started bridge that never answers is an error", async () => {
  await assert.rejects(install(ctxWith(systemctl().run, { BRIDGE_PORT: "1" }), opts()), { status: 400, message: /the runner didn't answer/ });
});

test("with no systemd user manager install writes no unit and says to run serve yourself", async () => {
  const sc = systemctl({ "--user is-system-running": { status: 1, stdout: "" } });
  await install(ctxWith(sc.run), opts());
  assert.ok(!fs.existsSync(unitFile(home)));
  assert.deepEqual(sc.calls, ["--user is-system-running"]);
  assert.match(printed.join("\n"), /no systemd the bridge drives.*serve.*own supervisor/s);
});

test("uninstall stops a service it defined, and only that", async () => {
  await install(ctxWith(systemctl().run), opts());
  printed.length = 0;
  const sc = systemctl();
  uninstall(ctxWith(sc.run));
  assert.deepEqual(sc.calls, [`--user disable --now ${UNIT}`]);
  assert.deepEqual(printed, ["Stopped the runner."]);
  assert.equal(readEnv(settingsFile(home)).ANYTHINGLLM_STORAGE, undefined);

  fs.rmSync(unitFile(home));
  const none = systemctl();
  printed.length = 0;
  uninstall(ctxWith(none.run));
  assert.ok(!none.calls.some((c) => c.includes("disable")));
  assert.match(printed[0], /Forgot the storage/);
});

test("uninstall says so when systemctl would not stop the service, whatever state the manager is in", async () => {
  await install(ctxWith(systemctl().run), opts());
  printed.length = 0;
  uninstall(ctxWith(systemctl({ "--user is-system-running": { status: 1, stdout: "stopping\n" }, [`--user disable --now ${UNIT}`]: { status: 1 } }).run));
  assert.match(printed[0], /Forgot the storage, but `systemctl --user disable --now anythingllm-bridge\.service` failed/);
});

test("the user manager is usable while it is running, degraded or starting, and not otherwise", () => {
  const says = (stdout: string) => usable(() => ({ status: stdout ? 0 : 1, stdout: `${stdout}\n` }));
  for (const state of ["running", "degraded", "starting"]) assert.ok(says(state), state);
  for (const state of ["initializing", "maintenance", "stopping", "offline", "unknown", ""]) assert.ok(!says(state), JSON.stringify(state));
});

test("health shows the unit's state, and fails when it is not active", async () => {
  await install(ctxWith(systemctl().run), opts());
  printed.length = 0;
  await health(ctxWith(systemctl({ [`--user is-active ${UNIT}`]: { status: 0, stdout: "active\n" } }).run));
  assert.ok(printed.includes(`ok   ${UNIT}: active`), printed.join("\n"));
  printed.length = 0;
  assert.equal(await health(ctxWith(systemctl({ [`--user is-active ${UNIT}`]: { status: 3, stdout: "failed\n" } }).run)), false);
  assert.ok(printed.includes(`FAIL ${UNIT}: failed`), printed.join("\n"));
});
