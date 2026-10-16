import assert from "node:assert/strict";
import { test } from "node:test";
import { scopeOf } from "../src/scope.ts";

const invoked = (invocation: Record<string, unknown>) => ({ super: { handlerProps: { invocation } } });

test("a call's workspace and thread come from AnythingLLM's invocation", () => {
  assert.deepEqual(scopeOf(invoked({ workspace: { slug: "home" }, thread_id: 12 })), { workspace: "home", thread: 12, job: false });
  assert.deepEqual(scopeOf(invoked({ workspace: { slug: "home" }, thread_id: "12" })), { workspace: "home", thread: 12, job: false });
  assert.deepEqual(scopeOf(invoked({ workspace: { slug: "home" }, thread_id: null })), { workspace: "home", job: false }, "the workspace's own chat has no thread");
  assert.deepEqual(scopeOf({}), { workspace: "_jobs", job: true }, "a scheduled job has no workspace");
});
