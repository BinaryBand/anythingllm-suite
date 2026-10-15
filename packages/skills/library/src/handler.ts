// The user's own library of API toolkits, as one agent skill: for each service, what the agent
// learned of its API (store.ts), the keys it calls with (secrets.ts, kept in the vault, which the
// model never reads) and small JavaScript functions it wrote, run in QuickJS (sandbox.ts, runs.ts).
// One library for the whole AnythingLLM, kept in its storage (<storage>/library-lean/), so every
// workspace and every scheduled job shares it. What is tuned rather than coded (the guide, the
// snippets, the prelude every function runs after) is in static/, which the user can override file
// by file on their instance.
//
// esbuild bundles this into the one handler.js AnythingLLM loads.

import path from "node:path";
import { workspaceOf } from "#shared/anythingllm";
import { answerText, keepOf, objectOf, textOf } from "#shared/answer";
import { Told } from "#shared/errors";
import { checkUrl } from "#shared/fence";
import { staticFiles, type StaticFiles } from "#shared/static";
import { LibraryError } from "./errors";
import type { HandlerContext } from "./host";
import { check } from "./policy";
import { send } from "./request";
import { execute, runText } from "./runs";
import { check as compiles } from "./sandbox";
import * as secrets from "./secrets";
import * as store from "./store";

type Args = Record<string, unknown>;

const clean = (v: unknown): string => String(v ?? "").trim();

/** The static files, as shipped or as tuned on this instance (<storage>/library-lean/static/). */
const statics = (): StaticFiles => staticFiles(STATIC_FILES, path.join(store.libraryDir(), "static"));

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

/** The scripts every function runs after, by their names. */
function prelude(): Record<string, string> {
  const s = statics();
  return Object.fromEntries(s.list("prelude/").map((f) => [`prelude/${f}`, s.get(`prelude/${f}`)!.text]));
}

const ago = (iso: string): string => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 90 ? `${s} s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 129600 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`;
};

const runLine = (r: store.RunRecord) => `- ${r.fn}: ${r.status}${r.error ? ` (${r.error.name}: ${r.error.message.slice(0, 80)})` : ""}, ${ago(r.ended)}${r.trigger === "job" ? ", from a scheduled job" : ""} [${r.id}]`;

/** The toolkit's keys, each saved (its label in `saved`) or not. */
function keyStatus(kit: store.Toolkit, saved: Set<string>): string {
  return kit.secrets.length ? kit.secrets.map((s) => `${s.label} (${s.as}, ${saved.has(s.label.toLowerCase()) ? "saved" : "not saved: ask with secret"})`).join(", ") : "none";
}

/** The library at a glance, or one toolkit in full; its recent runs after. */
function library(args: Args): string {
  const saved = new Set(secrets.keys().map((k) => k.label.toLowerCase()));
  const service = clean(args.service) ? store.serviceOf(args.service) : "";
  const lines = service ? toolkitLines(service, saved) : listingLines(saved);
  const runs = store.recentRuns(5, service);
  if (runs.length && lines.length > 1) lines.push("", "Recent runs:", ...runs.map(runLine));
  return lines.join("\n");
}

function toolkitLines(service: string, saved: Set<string>): string[] {
  const kit = store.toolkit(service);
  if (!kit) throw new LibraryError(`there's no toolkit "${service}"; the toolkits are: ${store.services().join(", ") || "none yet"}`);
  const fns = store.functions(service);
  return [
    `Toolkit ${service}: ${kit.title}`,
    `Base addresses: ${kit.base_urls.join(", ")}`,
    `Hosts its functions reach: ${store.hostsOf(kit).join(", ")}`,
    `Keys: ${keyStatus(kit, saved)}`,
    ...(kit.docs.length ? [`Docs: ${kit.docs.join(", ")}`] : []),
    "",
    "Functions:",
    ...(fns.length ? fns.map((f) => `- ${service}.${f.name}(${Object.entries(f.inputs).map(([n, i]) => `${n}${i.required ? "" : "?"}: ${i.type}`).join(", ")}): ${f.description} (version ${f.version})`) : ["none yet"]),
    "",
    "Notes:",
    kit.notes || "none",
  ];
}

function listingLines(saved: Set<string>): string[] {
  const services = store.services();
  if (!services.length) return ["The library is empty: no toolkit yet. guide says how to build one (topic toolkits)."];
  const lines = ["The library's toolkits (library with service for one in full):"];
  for (const service of services) {
    const kit = store.toolkit(service)!;
    lines.push(`- ${service}: ${kit.title}. Functions: ${store.functionNames(service).join(", ") || "none yet"}. Keys: ${keyStatus(kit, saved)}`);
  }
  return lines;
}

/** Asks the user for a key and keeps it, unseen. */
async function secret(args: Args, self: HandlerContext): Promise<string> {
  const kind = clean(args.kind).toLowerCase() || "key";
  if (kind !== "key") throw new LibraryError('secret\'s kind is "key" (an API key or token) for now; OAuth sign-ins come later');
  const site = secrets.siteChecked(args.site);
  const label = secrets.labelOf(clean(args.label) || site);
  await secrets.askKey(self, site, label);
  return `Saved the key the user gave for ${site} as "${label}". It's hidden from you and goes only to ${site}. Name it in the toolkit's secrets, as { "label": "${label}", "as": "bearer" } or however the API's docs say it goes; call with auth { "key": "${label}", "as": ... } to try it.`;
}

/** auth as call takes it: none, how the key saved for the address's site goes ("bearer"), or
 *  { key, as }. */
function authOf(auth: unknown, host: string): { label: string; as: string } | null {
  if (auth === undefined || auth === null || auth === "" || auth === "none") return null;
  const given = typeof auth === "string" && !auth.trim().startsWith("{") ? { as: auth } : (objectOf(auth, "auth") as { key?: unknown; as?: unknown });
  const as = secrets.asOf(given.as);
  return { label: clean(given.key) || secrets.labelForHost(host), as };
}

/** One request, to find out how an API answers: its docs, its spec, an endpoint. */
async function call(args: Args): Promise<string> {
  if (!args.url) throw new LibraryError("call needs url, the address to send it to");
  const target = new URL(checkUrl(args.url));
  const keep = keepOf(args.keep);
  const key = authOf(args.auth, target.hostname);
  const sent = await send(target, args, key, null);
  return answerText(textOf(sent.answer), `${sent.method} ${target.href}${key ? ` (with the key "${key.label}")` : ""}`, keep, sent.secret ? [sent.secret] : []);
}

const start = (self: HandlerContext) => {
  const workspace = workspaceOf(self);
  return { trigger: workspace ? ("chat" as const) : ("job" as const), workspace, prelude: prelude() };
};

/** Saves a toolkit, a function or both; removes one; runs what was saved with `test`. */
async function save(args: Args, self: HandlerContext): Promise<string> {
  const service = store.serviceOf(args.service);
  if (clean(args.remove)) {
    const what = clean(args.remove).toLowerCase();
    if (what === service) return store.removeToolkit(service) ? `Removed the toolkit ${service} and its functions. Its keys stay saved.` : `There was no toolkit ${service}.`;
    const { name } = store.qualified(what.includes(".") ? what : `${service}.${what}`);
    return store.removeFn(service, name) ? `Removed ${service}.${name}.` : `${service} has no function ${name}.`;
  }
  const lines: string[] = [];
  if (args.toolkit !== undefined) {
    const kit = store.saveToolkit(service, objectOf(args.toolkit, "toolkit"));
    lines.push(`Saved the toolkit ${service}: ${kit.base_urls.join(", ")}; keys: ${kit.secrets.map((s) => s.label).join(", ") || "none"}.`);
  }
  let saved = "";
  if (args.function !== undefined) {
    if (!store.toolkit(service)) throw new LibraryError(`there's no toolkit ${service} yet: save it first (or in the same call), with toolkit`);
    const given = objectOf(args.function, "function") as { name?: unknown; description?: unknown; inputs?: unknown; source?: unknown };
    const { name } = store.qualified(`${service}.${clean(given.name)}`);
    const source = String(given.source ?? "");
    const failure = await compiles(source);
    if (failure) throw new LibraryError(`${service}.${name} wasn't saved: ${failure.name}: ${failure.message}${failure.line ? ` (line ${failure.line})` : ""}`);
    check({ op: "save", fn: `${service}.${name}`, source });
    const f = store.saveFn(service, name, { description: given.description, inputs: given.inputs, source });
    saved = `${service}.${name}`;
    lines.push(`Saved ${saved}, version ${f.version}. Run it with run, name "${saved}".`);
  }
  if (!lines.length) throw new LibraryError("save takes toolkit, function (or both), or remove");
  if (args.test !== undefined && saved) lines.push("", runText(await execute(saved, objectOf(args.test, "test"), start(self))));
  return lines.join("\n");
}

/** Runs a function, or shows a run already made. */
async function run(args: Args, self: HandlerContext): Promise<string> {
  if (clean(args.run_id)) {
    const record = store.runOf(clean(args.run_id));
    if (!record) throw new LibraryError(`there's no run ${clean(args.run_id)}`);
    return runText(record);
  }
  if (!clean(args.name)) throw new LibraryError('run needs name, the function as service.function, like "github.list_issues"');
  return runText(await execute(clean(args.name), objectOf(args.inputs, "inputs"), start(self)));
}

const ACTIONS: Record<string, (args: Args, self: HandlerContext) => Promise<string> | string> = { guide, library, secret, call, save, run };

export const runtime = {
  handler: async function (this: HandlerContext, args: Args = {}): Promise<string> {
    const action = clean(args.action).toLowerCase() || "guide";
    const act = ACTIONS[action];
    if (!act) return `The library's action is ${Object.keys(ACTIONS).join(", ")}, not "${clean(args.action)}".`;
    try {
      return await act(args, this);
    } catch (e) {
      if (e instanceof Told) return `Library: ${e.message}.`;
      this.logger?.(`library-lean ${action} failed: ${(e as Error)?.stack || e}`);
      return `Library ${action} failed: ${(e as Error)?.message || e}. Tell the user what went wrong; don't retry on your own.`;
    }
  },
};
