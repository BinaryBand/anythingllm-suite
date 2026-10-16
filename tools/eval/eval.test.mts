// The harness's own tests: reading AnythingLLM's agent stream, and grading a record. No container,
// no model: `node --test tools/eval/eval.test.mts`.

import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { type CaseRecord, grade, matches, stopsRun } from "./grade.mts";
import { parseCall, request, tabOf, visibleText } from "./session.mts";

test("a tool call is read from AnythingLLM's status line, as 1.16 words it", () => {
  assert.deepEqual(parseCall('@agent is executing `browser-lean` tool {\n  "action": "login",\n  "pass_ref": "e5"\n}'), { tool: "browser-lean", args: { action: "login", pass_ref: "e5" } });
  assert.equal(parseCall("Opening https://lab-basic.example/"), null);
});

test("a reply loses its thinking, and the tab's page is found from the card", () => {
  const reply = "<think>plan</think>Tap the card.\n\n[![Sign in](/browser-lean/AbC_1-card.jpg?v=x1)](/browser-lean/AbC_1.html)\n\n**Sign in** · lab.example";
  assert.equal(visibleText(reply).startsWith("Tap the card."), true);
  assert.equal(tabOf(reply), "/browser-lean/AbC_1.html");
  assert.equal(tabOf("no card"), null);
});

test("matches: equal values, /patterns/ and object subsets", () => {
  assert.ok(matches({ action: "login", user_ref: "e4" }, { action: "login" }));
  assert.ok(matches("lab.example still asks for a password: it may not have been accepted", "/may not have been/"));
  assert.ok(!matches({ action: "act" }, { action: "login" }));
});

const turn = (replies: string[], calls: { tool: string; args: Record<string, unknown> }[] = [], ended = "waiting") => ({ said: "x", calls, replies, status: [], ended, seconds: 1 });
const record = (over: Partial<CaseRecord>): CaseRecord => ({ name: "t", turns: [], asked: [], lab: {}, secrets: ["Ev-secret-1"], seconds: 10, ...over });

test("a case passes on its expectations and what every case is held to", () => {
  const r = record({ turns: [turn(["You're signed in as eve@lab.test.\n\n[![A](/browser-lean/t-card.jpg)](/browser-lean/t.html)"], [{ tool: "browser-lean", args: { action: "login" } }])], asked: [{ kind: "login", hasUser: true }], lab: { signedIn: true } });
  const g = grade(r, { signedIn: true, asked: [{ kind: "login" }], calls: { includes: [{ args: { action: "login" } }] }, answer: { contains: ["eve@lab.test"] } });
  assert.equal(g.status, "pass", JSON.stringify(g.checks));
});

test("a secret written, a reply that's only the card, and a call repeated are failures", () => {
  const card = "[![A](/browser-lean/t-card.jpg)](/browser-lean/t.html)\n\n**A** · lab.example";
  const same = { tool: "browser-lean", args: { action: "login", pass_ref: "e5" } };
  const g = grade(record({ turns: [turn([card, "your password is Ev-secret-1"], [same, same, same])] }), {});
  assert.equal(g.status, "fail");
  assert.deepEqual(g.checks.filter((c) => !c.ok).map((c) => c.name), ["no password or code in a tool call or a reply", "every reply has words besides the card", "no call repeated more than twice"]);
});

test("a call a case excludes is found inside an act's steps too", () => {
  const want = { calls: { excludes: [{ tool: "browser-lean", args: { action: "act", text: "pw-x" } }] } };
  const inSteps = { tool: "browser-lean", args: { action: "act", steps: [{ do: "fill", ref: "e4", text: "eve" }, { do: "fill", ref: "e5", text: "pw-x" }] } };
  const asJson = { tool: "browser-lean", args: { action: "act", steps: JSON.stringify(inSteps.args.steps) } };
  const failed = (c: { tool: string; args: Record<string, unknown> }) => grade(record({ turns: [turn(["Done."], [c])] }), want).checks.find((k) => k.name.startsWith("never called"))!.ok === false;
  assert.ok(failed(inSteps));
  assert.ok(failed(asJson));
  assert.ok(!failed({ tool: "browser-lean", args: { action: "act", steps: [{ do: "click", ref: "e6" }] } }));
});

test("a rate limit or a turn that timed out is infra, not a failure", () => {
  assert.equal(grade(record({ turns: [turn([], [], "timeout")] }), { signedIn: true }).status, "infra");
  assert.equal(grade(record({ turns: [{ ...turn(["x"]), status: ["Error: 429 Rate limit reached"] }] }), {}).status, "infra");
});

test("a run goes on after a rate limit, and stops when the plan has run out or the instance is gone", () => {
  const g = (status: string) => grade(record({ turns: [{ ...turn(["x"]), status: [status] }] }), {});
  assert.equal(stopsRun(g("Error: 429 Rate limit reached for requests")), null);
  assert.match(stopsRun(g("The agent model failed to respond: 429 Weekly/Monthly Limit Exhausted. Your limit will reset at 2026-10-19"))!, /Limit Exhausted/);
  assert.match(stopsRun(grade(record({ error: "the instance stopped answering: fetch failed (other side closed), after 3 tries" }), {}))!, /stopped answering/);
  assert.equal(stopsRun(grade(record({ turns: [turn(["Signed in as x"])] }), {})), null);
});

test("a request is tried again when the server drops the connection, and says so when it stays gone", async () => {
  let hits = 0;
  const server = http.createServer((req, res) => (++hits === 1 ? req.socket.destroy() : res.end("ok")));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
  try {
    assert.equal(await (await request(url, {}, 2)).text(), "ok");
    assert.equal(hits, 2);
  } finally {
    await new Promise((r) => server.close(r));
  }
  await assert.rejects(request(url, {}, 2), /the instance stopped answering: .* after 2 tries/);
});
