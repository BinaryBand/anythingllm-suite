// Long-term memory for AnythingLLM's agent, as one agent skill and nothing else: no server, no
// other process, no embedding model of its own. The agent keeps short facts about the user and
// finds them again by meaning, with AnythingLLM's own embedder and vector database (bank.ts,
// vectors.ts); the facts' texts live in a small index in AnythingLLM's storage (index.ts).
//
// esbuild bundles this into the one handler.js AnythingLLM loads, so there are no sibling modules
// for AnythingLLM to keep cached between runs.

import { workspaceOf } from "#shared/anythingllm";
import * as f from "./facts";
import { MemoryError } from "./facts";
import { bank } from "./bank";
import type { HandlerContext } from "./host";

type Args = Record<string, unknown>;

// Reads see the workspace's facts and the global ones, or the one scope the call names; update and
// forget find a fact in either; remember keeps a fact in the scope it names, global by default.
const ACTIONS: Record<string, (args: Args, ws: string | null) => Promise<string>> = {
  recall: (args, ws) => bank.recall({ scopes: f.visible(args.scope, ws), query: args.query ?? args.text, k: args.k }),
  remember: (args, ws) => bank.remember({ scope: f.scopeOf(args.scope, ws) ?? f.GLOBAL, text: args.text, kind: args.kind, tags: args.tags }),
  update: (args, ws) => bank.update({ scopes: f.scopesOf(ws || f.GLOBAL), id: args.id, text: args.text, apply: f.flag(args.apply) }),
  forget: (args, ws) => bank.forget({ scopes: f.scopesOf(ws || f.GLOBAL), id: args.id, apply: f.flag(args.apply) }),
  list: (args, ws) => bank.list({ scopes: f.visible(args.scope, ws) }),
};

export const runtime = {
  handler: async function (this: HandlerContext, args: Args = {}): Promise<string> {
    const action = f.clean(args.action).toLowerCase();
    const run = ACTIONS[action];
    if (!run) return `memory-lean's action is recall, remember, update, forget or list, not "${f.clean(args.action)}".`;
    try {
      return await run(args, workspaceOf(this));
    } catch (e) {
      if (e instanceof MemoryError) return `Couldn't ${action}: ${e.message}.`;
      this.logger?.(`memory-lean ${action} failed: ${(e as Error)?.stack || e}`);
      return `Couldn't ${action}: ${(e as Error)?.message || e}. Tell the user what went wrong; don't retry on your own.`;
    }
  },
};
