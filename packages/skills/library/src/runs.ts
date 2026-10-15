// Running a function: its kit, its limits, and the record of what it did. A function reaches the web
// only through kit.http, and only its own toolkit's hosts, with its own toolkit's keys, which are
// added outside the script (request.ts) and hidden in everything the script and the agent are shown.
// A function runs another (a flow) with kit.run; that one gets its own toolkit's kit, and shares the
// run's deadline, its budget of requests and its log. A refusal here is a LibraryError, which the
// script sees as it is (sandbox.ts).

import { DATA, clipped, mask, shownHeaders, textOf } from "#shared/answer";
import { checkUrl, onSite } from "#shared/fence";
import { LibraryError } from "./errors";
import { check } from "./policy";
import { send } from "./request";
import { run as runScript, type Kit, type Outcome } from "./sandbox";
import * as store from "./store";
import type { Fn, RunRecord, Toolkit } from "./store";

/** How long a run may take, and what it may do in that time. */
export const LIMITS = { wallMs: 3 * 60 * 1000, requests: 200, depth: 4, logs: 200, logChars: 500, sleepMs: 10 * 1000 };

export interface Start {
  trigger: RunRecord["trigger"];
  workspace: string | null;
  /** The scripts every function runs after (static/prelude). */
  prelude: Record<string, string>;
}

/** What a run and the functions it runs share. */
interface Budget {
  start: Start;
  deadline: number;
  requests: number;
  logs: string[];
  made: RunRecord["calls"];
  /** Every key a request sent, to hide wherever it shows. */
  secrets: string[];
}

/** Runs the function `qualifiedName` ("github.list_issues") to its end, and keeps the record. */
export async function execute(qualifiedName: string, input: unknown, start: Start): Promise<RunRecord> {
  const { service, name } = store.qualified(qualifiedName);
  const { kit, f } = loaded(service, name);
  const values = store.inputChecked(f, input);
  check({ op: "run", fn: `${service}.${name}`, trigger: start.trigger });
  const budget: Budget = { start, deadline: Date.now() + LIMITS.wallMs, requests: 0, logs: [], made: [], secrets: [] };
  const started = new Date();
  const outcome = await call(kit, f, values, budget, 0, null);
  const ended = new Date();
  const record: RunRecord = {
    id: store.runId(started),
    fn: `${service}.${name}`,
    trigger: start.trigger,
    workspace: start.workspace,
    started: started.toISOString(),
    ended: ended.toISOString(),
    ms: ended.getTime() - started.getTime(),
    status: outcome.ok ? "ok" : outcome.error.name === "Timeout" ? "timeout" : "error",
    ...(outcome.ok ? { result: outcome.value } : { error: outcome.error }),
    logs: budget.logs,
    calls: budget.made,
  };
  store.record(record);
  return record;
}

function loaded(service: string, name: string): { kit: Toolkit; f: Fn } {
  const kit = store.toolkit(service);
  if (!kit) throw new LibraryError(`there's no toolkit "${service}"; library lists them`);
  const f = store.fn(service, name);
  if (!f) throw new LibraryError(`the toolkit ${service} has no function "${name}"; library with service "${service}" lists its functions`);
  return { kit, f };
}

/** Runs one function inside a run; `parent` is the stop signal of the function that runs it. */
async function call(kit: Toolkit, f: Fn, input: unknown, budget: Budget, depth: number, parent: AbortSignal | null): Promise<Outcome> {
  const stop = new AbortController(); // the sandbox aborts it as the function ends
  const onParent = () => stop.abort();
  parent?.addEventListener("abort", onParent, { once: true });
  const state = { read: false, value: null as unknown, changed: false };
  try {
    const outcome = await runScript({ source: f.source, input, kit: kitFor(kit, f, budget, depth, state, stop.signal), prelude: budget.start.prelude, deadline: budget.deadline, stop });
    if (outcome.ok && state.changed) store.saveState(kit.service, f.name, state.value);
    return outcome;
  } finally {
    parent?.removeEventListener("abort", onParent);
  }
}

const logged = (v: unknown) => (typeof v === "string" ? v : (JSON.stringify(v) ?? String(v)));

function kitFor(kit: Toolkit, f: Fn, budget: Budget, depth: number, state: { read: boolean; value: unknown; changed: boolean }, signal: AbortSignal): Kit {
  return {
    http: (req) => http(kit, f, (req ?? {}) as Request, budget, signal),
    log: (...args) => {
      if (budget.logs.length < LIMITS.logs) budget.logs.push(mask(args.map(logged).join(" "), budget.secrets).slice(0, LIMITS.logChars));
    },
    run: async (name, input) => {
      if (depth + 1 >= LIMITS.depth) throw new LibraryError(`functions run functions at most ${LIMITS.depth} deep`);
      const q = store.qualified(name);
      const next = loaded(q.service, q.name);
      const outcome = await call(next.kit, next.f, store.inputChecked(next.f, input), budget, depth + 1, signal);
      if (outcome.ok) return outcome.value;
      throw new LibraryError(`${q.service}.${q.name} failed: ${outcome.error.name}: ${outcome.error.message}${outcome.error.line ? ` (its line ${outcome.error.line})` : ""}`);
    },
    state: {
      get: () => {
        if (!state.read) Object.assign(state, { read: true, value: store.stateOf(kit.service, f.name) });
        return state.value;
      },
      set: (value) => {
        if ((JSON.stringify(value ?? null) ?? "").length > store.MAX_STATE) throw new LibraryError(`what a function keeps is at most ${store.MAX_STATE / 1024} KB as JSON`);
        Object.assign(state, { read: true, value: value ?? null, changed: true });
      },
    },
    sleep: (ms) =>
      new Promise((resolve, reject) => {
        const stopped = () => (clearTimeout(timer), reject(new LibraryError("the run stopped")));
        const timer = setTimeout(() => (signal.removeEventListener("abort", stopped), resolve(undefined)), Math.min(Math.max(Number(ms) || 0, 0), LIMITS.sleepMs));
        signal.addEventListener("abort", stopped, { once: true });
      }),
  };
}

interface Request {
  method?: string;
  path?: string;
  url?: string;
  params?: unknown;
  headers?: unknown;
  body?: unknown;
  /** The toolkit key to send, by its name; the first by default; false for none. */
  auth?: string | false;
}

/** One request a function sends: to its toolkit's hosts only, with its toolkit's key. */
async function http(kit: Toolkit, f: Fn, req: Request, budget: Budget, signal: AbortSignal) {
  if (++budget.requests > LIMITS.requests) throw new LibraryError(`a run sends at most ${LIMITS.requests} requests`);
  const target = new URL(req.url ? checkUrl(req.url) : `${kit.base_urls[0]}/${String(req.path ?? "").replace(/^\//, "")}`);
  const hosts = store.hostsOf(kit);
  if (!hosts.some((h) => onSite(target.hostname, h))) throw new LibraryError(`${target.hostname} isn't one of the ${kit.service} toolkit's hosts (${hosts.join(", ")}): add it to the toolkit's hosts if its API sends there`);
  const label = req.auth === false || req.auth === "none" ? null : typeof req.auth === "string" ? req.auth : (kit.secrets[0]?.label ?? null);
  const key = label ? kit.secrets.find((s) => s.label.toLowerCase() === label.toLowerCase()) : null;
  if (label && !key) throw new LibraryError(`the ${kit.service} toolkit has no key "${label}"; its keys are ${kit.secrets.map((s) => s.label).join(", ") || "none"}`);
  const made = { method: String(req.method || "GET").toUpperCase(), host: target.host, path: target.pathname, ms: 0 };
  const t0 = Date.now();
  try {
    const sent = await send(target, req, key ?? null, `${kit.service}.${f.name}`, signal);
    if (sent.secret && !budget.secrets.includes(sent.secret)) budget.secrets.push(sent.secret);
    budget.made.push({ ...made, status: sent.answer.status, ms: Date.now() - t0 });
    const got = textOf(sent.answer);
    const text = mask(got.text, budget.secrets);
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {}
    const status = sent.answer.status;
    return { status, ok: status >= 200 && status < 300, headers: shownHeaders(sent.answer.headers), body: got.binary ? null : body, cut: got.cut, ...(got.binary ? { binary: got.bytes } : {}) };
  } catch (e) {
    budget.made.push({ ...made, error: (e as Error).message.slice(0, 200), ms: Date.now() - t0 });
    throw e;
  }
}

/** A run as the agent reads it. */
export function runText(run: RunRecord): string {
  const lines = [`Ran ${run.fn} (${run.id}): ${run.status}, ${(run.ms / 1000).toFixed(1)} s, ${run.calls.length} request${run.calls.length === 1 ? "" : "s"}.`];
  if (run.status === "ok") lines.push(...clipped("Result", "JSON", JSON.stringify(run.result, null, 1) ?? "null", run.result));
  else if (run.error) lines.push(`Error: ${run.error.name}: ${run.error.message}${run.error.line ? ` (line ${run.error.line} of the function)` : ""}`);
  if (run.logs.length) lines.push("", `Log (${run.logs.length > 20 ? "the last 20 lines" : "every line"}):`, ...run.logs.slice(-20));
  if (run.calls.length) {
    lines.push("", "Requests:");
    for (const c of run.calls.slice(-20)) lines.push(`- ${c.method} ${c.host}${c.path}: ${c.status ?? c.error} (${c.ms} ms)`);
  }
  lines.push("", DATA);
  return lines.join("\n");
}
