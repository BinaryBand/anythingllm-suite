import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { chatRoutes, missingRules, parseRules, route, show } from "../src/allow.mts";

// The default list the parts agree on (contract/default-allow.txt).
const CLIENT_ALLOW = fs.readFileSync(fileURLToPath(new URL("../../../contract/default-allow.txt", import.meta.url)), "utf8").trim();
const CHAT = chatRoutes(CLIENT_ALLOW);

const passes = (allow: string, method: string, path: string, query = ""): string => route(parseRules(allow), method, path, query);

test("a rule is a method and a path prefix", () => {
  assert.deepEqual(parseRules("GET /scheduled-jobs, /workspaces ,post /system/custom-models,").map(show), [
    "GET /scheduled-jobs",
    "/workspaces",
    "POST /system/custom-models",
  ]);
  assert.deepEqual(parseRules(""), []);
});

test("a bad rule is refused by name", () => {
  for (const text of ["scheduled-jobs", "/", "FETCH /x", "GET", "GET /a/../b", "GET //"]) {
    assert.throws(() => parseRules(text), /BRIDGE_ALLOW/, text);
  }
});

test("a prefix matches whole segments and the method", () => {
  assert.equal(passes("GET /workspaces", "GET", "workspaces/home/memories"), "/workspaces/home/memories");
  for (const [method, path] of [["GET", "workspaces-old"], ["GET", "workspace"], ["POST", "workspaces"]]) {
    assert.throws(() => passes("GET /workspaces", method, path), { status: 403 }, `${method} ${path}`);
  }
});

test("a rule with no method allows each of the four", () => {
  for (const method of ["GET", "POST", "PUT", "DELETE"]) assert.equal(passes("/memories", method, "memories/3"), "/memories/3");
  assert.throws(() => passes("/memories", "PATCH", "memories/3"), { status: 403 });
});

test("the client routes pass what AnywhereLLM Lite calls and no more", () => {
  const allowed = [
    ["GET", "workspaces/home/memories"], ["POST", "workspaces/home/memories"], ["PUT", "memories/3"], ["DELETE", "memories/3"],
    ["POST", "memories/3/promote"], ["POST", "memories/3/demote/home"], ["GET", "admin/system-preferences-for"],
    ["POST", "admin/system-preferences"], ["GET", "scheduled-jobs"], ["GET", "scheduled-jobs/1/runs"], ["POST", "scheduled-jobs/new"],
    ["PUT", "scheduled-jobs/1"], ["DELETE", "scheduled-jobs/1"], ["POST", "scheduled-jobs/1/trigger"], ["GET", "workspaces"],
    ["GET", "workspace/home/threads"], ["GET", "workspace/home/thread/abc/chats"], ["POST", "workspace/home/thread/new"],
    ["POST", "workspace/home/thread/abc/update"], ["DELETE", "workspace/home/thread/abc"],
    ["DELETE", "workspace/home/thread/abc/delete-edited-chats"],
  ];
  for (const [method, path] of allowed) assert.doesNotThrow(() => passes(CLIENT_ALLOW, method, path), `${method} ${path}`);
  const refused = [
    ["GET", "system/api-keys"], ["POST", "system/update-env"], ["POST", "admin/system-preferences-for"], ["GET", "admin/users"],
    ["DELETE", "workspace/home"], ["POST", "workspace/home/update"], ["POST", "workspace/home/reset-vector-db"],
    ["DELETE", "workspace/home/delete-chats"], ["DELETE", "workspace/home/thread-bulk-delete"], ["POST", "workspace/home/stream-chat"],
    ["POST", "workspace/home/thread/abc/stream-chat"], ["GET", "workspace/home/thread/abc"],
  ];
  for (const [method, path] of refused) assert.throws(() => passes(CLIENT_ALLOW, method, path), { status: 403 }, `${method} ${path}`);
});

test("nothing passes without a rule", () => {
  assert.throws(() => passes("", "GET", "scheduled-jobs"), { status: 403 });
});

test("a path cannot climb out of its prefix", () => {
  for (const path of ["workspaces/../system/api-keys", "workspaces/./x", "workspaces//x", "workspaces\\x", ""]) {
    assert.throws(() => passes("/workspaces", "GET", path), { status: 400 }, JSON.stringify(path));
  }
});

test("the path goes upstream requoted, with its query", () => {
  assert.equal(passes("/workspaces", "POST", "workspaces/a?b/c", "x=1&y=%20"), "/workspaces/a%3Fb/c?x=1&y=%20");
  assert.equal(passes("/x", "GET", "x/it's(1)*!"), "/x/it%27s%281%29%2A%21"); // quoted as Python's quote(safe="") does
});

test("a query with control characters is refused", () => {
  assert.throws(() => passes("/x", "GET", "x", "a=1\r\nHost: y"), { status: 400 });
});

test("a star segment matches one segment and nothing else", () => {
  const rule = "POST /workspace/*/thread/*/update";
  assert.doesNotThrow(() => passes(rule, "POST", "workspace/home/thread/abc/update"));
  assert.doesNotThrow(() => passes(rule, "POST", "workspace/*/thread/*/update")); // a literal star is a segment
  for (const [method, path] of [
    ["POST", "workspace/thread/abc/update"], // one segment short
    ["POST", "workspace/home/thread/update"],
    ["POST", "workspace/home/other/abc/update"], // a literal segment still has to match
    ["GET", "workspace/home/thread/abc/update"],
  ]) {
    assert.throws(() => passes(rule, method, path), { status: 403 }, `${method} ${path}`);
  }
});

test("a star cannot be used to climb out", () => {
  for (const path of ["workspace/../thread/abc/update", "workspace/home/thread/../update"]) {
    assert.throws(() => passes("POST /workspace/*/thread/*/update", "POST", path), { status: 400 }, path);
  }
});

test("a star rule prints as written", () => {
  assert.deepEqual(parseRules("DELETE /workspace/*/thread/*").map(show), ["DELETE /workspace/*/thread/*"]);
});

test("the chat routes are the default's rules that name a workspace", () => {
  assert.deepEqual(CHAT.map(show), [
    "GET /workspace/*/threads", "GET /workspace/*/thread/*/chats", "POST /workspace/*/thread/new",
    "POST /workspace/*/thread/*/update", "DELETE /workspace/*/thread/*",
  ]);
});

test("missing rules are those nothing held covers", () => {
  const lacking = (held: string) => missingRules(parseRules(held), CHAT);
  assert.deepEqual(lacking(CLIENT_ALLOW), []);
  assert.equal(lacking("/scheduled-jobs").length, 5);
  assert.deepEqual(lacking("/workspace"), []); // a broader prefix
  assert.notDeepEqual(lacking("GET /workspace"), []); // but not a method short
  assert.deepEqual(lacking("/workspace/*/thread"), ["GET /workspace/*/threads"]);
  // A wildcard held covers a name wanted, never the other way round.
  assert.ok(lacking("GET /workspace/home/threads").includes("GET /workspace/*/threads"));
});
