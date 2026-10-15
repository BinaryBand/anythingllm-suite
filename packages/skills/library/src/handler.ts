// The user's own library of API toolkits, as one agent skill: for each service, what the agent
// learned of its API, the keys it calls with (kept in the vault, which the model never reads) and
// small JavaScript functions it wrote, run in QuickJS (sandbox.ts). One library for the whole
// AnythingLLM, kept in its storage (<storage>/library-lean/), so every workspace and every scheduled
// job shares it. What is tuned rather than coded (the guide, the snippets, the pages) is in static/,
// which the user can override file by file on their instance.
//
// esbuild bundles this into the one handler.js AnythingLLM loads.

import path from "node:path";
import { storageDir } from "#shared/anythingllm";
import { staticFiles, type StaticFiles } from "#shared/static";
import type { HandlerContext } from "./host";

export const HUB_ID = "library-lean";

type Args = Record<string, unknown>;

/** A refusal or a mistake to tell the agent as it is. */
class LibraryError extends Error {}

const clean = (v: unknown): string => String(v ?? "").trim();

/** The static files, as shipped or as tuned on this instance. */
const statics = (): StaticFiles => staticFiles(STATIC_FILES, path.join(storageDir(), HUB_ID, "static"));

/** One of the static files the agent reads by name: a guide topic or a snippet, with where it
 *  lives when it's tuned on this instance, so a drift is visible. */
function entry(s: StaticFiles, folder: string, ext: string, what: string, raw: unknown, fallback = ""): { name: string; text: string } {
  const given = clean(raw).toLowerCase();
  const name = (given.endsWith(ext) ? given.slice(0, -ext.length) : given) || fallback;
  const file = s.get(`${folder}/${name}${ext}`);
  if (!file) {
    const there = s.list(`${folder}/`).map((f) => f.slice(0, -ext.length)).filter((f) => f !== "index");
    throw new LibraryError(`there's no ${what} "${name}"; the ${what}s are: ${there.join(", ") || "none yet"}`);
  }
  return { name, text: file.text.trim() + (file.tuned ? `\n\n(Tuned on this instance: ${file.tuned})` : "") };
}

function guide(args: Args): string {
  const s = statics();
  if (clean(args.snippet)) {
    const { name, text } = entry(s, "snippets", ".js", "snippet", args.snippet);
    return `Snippet ${name} (a worked example: adapt it, don't save it as is):\n\n${text}`;
  }
  return entry(s, "guide", ".md", "topic", args.topic, "index").text;
}

const ACTIONS: Record<string, (args: Args, self: HandlerContext) => Promise<string> | string> = {
  guide,
};

export const runtime = {
  handler: async function (this: HandlerContext, args: Args = {}): Promise<string> {
    const action = clean(args.action).toLowerCase() || "guide";
    const act = ACTIONS[action];
    if (!act) return `library-lean's action is ${Object.keys(ACTIONS).join(", ")}, not "${clean(args.action)}".`;
    try {
      return await act(args, this);
    } catch (e) {
      if (e instanceof LibraryError) return `Library: ${e.message}.`;
      this.logger?.(`library-lean ${action} failed: ${(e as Error)?.stack || e}`);
      return `Library ${action} failed: ${(e as Error)?.message || e}. Tell the user what went wrong; don't retry on your own.`;
    }
  },
};
