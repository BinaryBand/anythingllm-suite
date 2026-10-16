// Where a call came from: its workspace and its thread, from AnythingLLM's invocation, never from
// what the model says, so each workspace's apps are its own. A call with no workspace (a scheduled
// job) gets "_jobs". The thread is AnythingLLM's own id for it; nothing here needs its slug, so
// nothing of AnythingLLM is loaded to find it.

import { workspaceOf } from "#shared/anythingllm";
import type { HandlerContext } from "./host.ts";

export interface Scope {
  workspace: string;
  thread?: number;
}

export function scopeOf(self: HandlerContext | undefined): Scope {
  const scope: Scope = { workspace: workspaceOf(self) ?? "_jobs" };
  const raw = self?.super?.handlerProps?.invocation?.thread_id;
  const thread = raw === null || raw === undefined ? NaN : Number(raw);
  if (Number.isInteger(thread)) scope.thread = thread;
  return scope;
}
