// Where a call came from: its workspace and its thread, from AnythingLLM's invocation, never from
// what the model says, so each workspace's apps are its own. A call with no workspace is a scheduled
// job's, and works in "_jobs" unless it names one (handler.ts, within what a job may do there). The
// thread is AnythingLLM's own id for it; nothing here needs its slug, so nothing of AnythingLLM is
// loaded to find it.

import { workspaceOf } from "#shared/anythingllm";
import type { HandlerContext } from "./host.ts";

export interface Scope {
  workspace: string;
  thread?: number;
  /** A scheduled job's call: AnythingLLM gave it no workspace. */
  job: boolean;
  /** A job's call in a workspace it named, where it may change only an app that takes jobs. */
  named?: boolean;
}

export function scopeOf(self: HandlerContext | undefined): Scope {
  const workspace = workspaceOf(self);
  const scope: Scope = { workspace: workspace ?? "_jobs", job: workspace === null };
  const raw = self?.super?.handlerProps?.invocation?.thread_id;
  const thread = raw === null || raw === undefined ? NaN : Number(raw);
  if (Number.isInteger(thread)) scope.thread = thread;
  return scope;
}
