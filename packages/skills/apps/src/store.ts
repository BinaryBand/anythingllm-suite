// A workspace's apps on disk. One app is one JSON file, <root>/<workspace>/<name>.json: what
// app.json holds (title, about, rules, schema, card, icon), its page.html (built from the parts),
// its data, its line (how many changes it has had), when it was made and last changed, the thread
// it was made in (AnythingLLM's id for it), its newest changes, each with the data as it was before
// and the thread it came from, so undo can step back, and its earlier app.json and page.html, so
// undo with a file can. Every write goes to a temporary file renamed over the app, so an app is
// never half written, and every read-change-write holds the app's lock (#shared/atomic), since a
// scheduled job runs in a process of its own.

import fs from "node:fs";
import path from "node:path";
import { locked, readJson, writeAtomic } from "#shared/atomic";
import { newSecret } from "#shared/pages";
import { Told } from "#shared/errors";
import { root } from "./dirs.ts";
import { apply, PatchError, type Json } from "./patch.ts";
import { DEFINITION, definitionOf, pageProblems } from "./parts.ts";
import { problems, unknownKeywords } from "./schema.ts";

/** A mistake in what the agent asked for, said back to it in words. */
export class AppError extends Told {}

const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
const WORKSPACE = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,127}$/;
export const KEEP = 20;
/** How many earlier versions of app.json and page.html an app keeps, together, for undo. */
export const VERSIONS = 10;
/** How many page events an app remembers by id, so one sent twice applies once. */
const SEEN = 100;
/** How many changes a page sent that were refused an app remembers, with why, for its page. */
const REFUSED = 20;
const TITLE_MAX = 80;
const CARD_KEYS = new Set(["summary", "lines", "items", "text", "done", "where"]);
const FILES = ["app.json", "page.html"];

const now = (): string => new Date().toISOString().replace(/\.\d+Z$/, "Z");

function folder(workspace: string): string {
  if (!WORKSPACE.test(workspace)) throw new AppError(`not a workspace: ${JSON.stringify(workspace)}`);
  return path.join(root(), workspace);
}

/** Why `name` can't be an app's name, or null. */
const nameProblem = (name: unknown): string | null => (typeof name === "string" && NAME.test(name) ? null : "an app's name is 1-63 lowercase letters, digits and hyphens, such as groceries");

function fileOf(workspace: string, name: unknown): string {
  const why = nameProblem(name);
  if (why) throw new AppError(why);
  return path.join(folder(workspace), `${name}.json`);
}

/** Runs `fn` holding the app's lock: one change to an app at a time, in any process. */
const withLock = <T,>(workspace: string, name: unknown, fn: () => T): Promise<T> => locked(`${fileOf(workspace, name)}.lock`, `the app ${name}`, fn);

// For the owner alone: an app holds its page's secret.
const save = (workspace: string, app: Json): void => writeAtomic(fileOf(workspace, app.name), JSON.stringify(app, null, 1) + "\n", 0o600);

export function read(workspace: string, name: unknown): Json {
  return readJson(fileOf(workspace, name), () => {
    throw new AppError(`this workspace has no app named ${name}; list shows its apps`);
  });
}

/** Reads the app, changes it with `fn` and saves what `fn` answers, all under the app's lock; an
 *  answer that is the app itself, or one marked a duplicate, is saved for none. */
function update(workspace: string, name: unknown, fn: (app: Json) => Json | Promise<Json>): Promise<Json> {
  return withLock(workspace, name, async () => {
    const app = read(workspace, name);
    const next = await fn(app);
    if (next !== app && !next.duplicate) save(workspace, next);
    return next;
  });
}

/** `app` with the ask `id` cleared, for a change made for it; throws, so nothing is saved, when the
 *  app has no such ask. No `id`: `app` as it is. */
function cleared(app: Json, id: unknown): Json {
  if (id === undefined) return app;
  const asks: Json[] = app.asks || [];
  if (!asks.some((a) => a.id === id)) throw new AppError(`${app.name} has no ask ${JSON.stringify(id)}${asks.length ? `; its asks are ${asks.map((a) => a.id).join(", ")}` : ""}: nothing was changed`);
  return { ...app, asks: asks.filter((a) => a.id !== id) };
}

/** `app` remembering the page event `id`, so one sent twice applies once. */
const seenWith = (app: Json, id: string): Json => ({ ...app, seen: [...(app.seen || []), id].slice(-SEEN) });
const isSeen = (app: Json, id: string | undefined): boolean => !!id && (app.seen || []).includes(id);

/** Why the definition can't hold `data`: every problem, empty when it can. The data is checked
 *  whenever the schema itself can be read, whatever else is wrong; the page only when `page`, as
 *  when it's new or changed (the check runs its scripts in a worker, which is the slow part). */
async function definitionProblems(app: Json, page: boolean): Promise<string[]> {
  const out: string[] = [];
  if (typeof app.title !== "string" || !app.title.trim() || app.title.length > TITLE_MAX) out.push(`title: 1-${TITLE_MAX} characters`);
  if (app.about !== undefined && typeof app.about !== "string") out.push("about: a sentence");
  if (!Array.isArray(app.rules) || app.rules.some((r: unknown) => typeof r !== "string")) out.push("rules: a list of sentences");
  const unknown = app.schema && typeof app.schema === "object" && !Array.isArray(app.schema) ? unknownKeywords(app.schema) : null;
  if (!unknown) out.push("schema: a JSON Schema object");
  else out.push(...unknown.map((k) => `schema${k}: not a keyword apps check; use type, properties, required, items, enum, minimum and the like`));
  if (!app.card || typeof app.card !== "object" || Array.isArray(app.card)) out.push("card: an object of summary, lines, items, text, done and where");
  else {
    for (const k of Object.keys(app.card)) if (!CARD_KEYS.has(k)) out.push(`card.${k}: not a card key (summary, lines, items, text, done, where)`);
    for (const k of ["summary", "lines"]) {
      const bad = typeof app.card[k] === "string" ? [...app.card[k].matchAll(/\{([^{}]*)\}/g)].map((m: RegExpMatchArray) => m[1]).filter((p: string) => !p.startsWith("/") || /\s/.test(p)) : [];
      if (bad.length) out.push(`card.${k}: {${bad[0]}} is not a pointer into the data; a card says {/items/length} or {/count}, one value each, and works out nothing`);
    }
    if (app.card.items !== undefined && (typeof app.card.items !== "string" || !app.card.items.startsWith("/"))) out.push("card.items: a pointer to a list, such as /items");
  }
  if (app.icon !== undefined && typeof app.icon !== "string") out.push("icon: a name");
  if (app.jobs !== undefined && typeof app.jobs !== "boolean") out.push("jobs: true lets a scheduled job change the data with do");
  if (page && app.page !== undefined) out.push(...(await pageProblems(app.page)));
  if (unknown && !unknown.length) out.push(...problems(app.data, app.schema).map((p) => `data ${p}`));
  return out;
}

/** `app`, unless it or `earlier` has a problem: then all of them, in one error. */
async function checked(app: Json, earlier: string[] = [], what = "saved", page = true): Promise<Json> {
  const found = [...earlier, ...(await definitionProblems(app, page))];
  if (found.length) throw new AppError(`the app can't be ${what}:\n- ${found.join("\n- ")}`);
  return app;
}

/** This workspace's apps, the newest change first. */
export function list(workspace: string): Json[] {
  const dir = folder(workspace);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !f.startsWith("."))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      } catch {
        return { name: f.slice(0, -5), title: f.slice(0, -5), broken: true, changed: "" };
      }
    })
    .sort((a, b) => (b.changed || "").localeCompare(a.changed || ""));
}

/** A name for an app called `title` that this workspace doesn't have yet: "Lisbon packing!" is
 *  lisbon-packing, then lisbon-packing-2. A model often leaves the name out. */
export function freeName(workspace: string, title: unknown): string {
  const base =
    String(title || "app").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 56).replace(/-+$/, "") || "app";
  for (let n = 1; ; n++) {
    const name = n === 1 ? base : `${base}-${n}`;
    if (!fs.existsSync(fileOf(workspace, name))) return name;
  }
}

/** A new app: `definition` is app.json's keys and `data`, its first data; `page` its page.html.
 *  `earlier` are problems the caller found, reported with the app's own. */
export async function create(workspace: string, name: unknown, definition: Json, thread?: number, earlier: string[] = []): Promise<Json> {
  const make = async () => {
    const found = [...earlier];
    const why = nameProblem(name);
    if (why) found.push(why);
    else if (fs.existsSync(fileOf(workspace, name))) found.push(`this workspace already has an app named ${name}`);
    const t = now();
    const app = await checked({ name, rules: [], ...definition, line: 0, made: t, changed: t, ...(thread !== undefined ? { thread } : {}), history: [], secret: newSecret() }, found, "made");
    save(workspace, app);
    return app;
  };
  // A name that can't be one has no lock to take: its problem is said with the others.
  return nameProblem(name) ? Promise.resolve().then(make) : withLock(workspace, name, make);
}

/** One change to an app's data, as an action or a page sends it. */
export interface Change {
  patch: Json;
  ev?: string;
  fields?: Json;
  thread?: number;
  by?: string;
  id?: string;
  /** The page's ask this change is made for, cleared with it. */
  ask?: string;
}

/** `app` with `patch` applied to its data and checked against its schema, unsaved. `by` names who
 *  changed it (the agent unless said); a change with an `id` already seen is skipped, and the app
 *  comes back as it was with `duplicate` set. */
function applyChange(app: Json, { patch, ev, fields, thread, by, id }: Change): Json {
  if (isSeen(app, id)) return { ...app, duplicate: true };
  let data;
  try {
    data = apply(app.data, patch);
  } catch (e) {
    if (e instanceof PatchError) throw new AppError(`the change doesn't apply: ${e.message}. read gives the data as it is now`);
    throw e;
  }
  const found = problems(data, app.schema);
  if (found.length) throw new AppError(`the change breaks the app's schema:\n- ${found.join("\n- ")}`);
  const line = (app.line || 0) + 1;
  // Each change keeps the line it made: an undo also takes a line, so the newest changes' lines
  // can't be worked out from where they stand in the history.
  const entry = { n: line, t: now(), by: by || "agent", ev: ev || "change", ...(fields ? { fields } : {}), ...(thread !== undefined ? { thread } : {}), patch, before: app.data };
  const next = { ...app, data, line, changed: entry.t, history: [...app.history, entry].slice(-KEEP) };
  return id ? seenWith(next, id) : next;
}

/** The app with `patch` applied to its data, checked against its schema and saved, and the ask it
 *  was made for, if any, cleared. */
export async function change(workspace: string, name: unknown, opts: Change): Promise<Json> {
  return update(workspace, name, (app) => {
    const next = applyChange(app, opts);
    return next.duplicate ? next : cleared(next, opts.ask);
  });
}

/** What became of one of several changes: made (`{}`), seen before, or refused with its error. */
export interface Answer {
  duplicate?: boolean;
  error?: Error;
}

/** Several changes to one app, in order, read once and saved once: one answer for each (the
 *  others still apply when one doesn't). Throws when the app can't be read or saved. */
export async function changeMany(workspace: string, name: unknown, changes: Change[]): Promise<Answer[]> {
  let answers: Answer[] = [];
  await update(workspace, name, (first) => {
    let app = first;
    answers = changes.map((opts): Answer => {
      try {
        const next = applyChange(app, opts);
        if (next.duplicate) return { duplicate: true };
        app = next;
        return {};
      } catch (error) {
        // A page's change that was refused is seen too, so the page stops showing it, and kept
        // with why, so the page can say so.
        if (opts.id && !isSeen(app, opts.id)) app = { ...seenWith(app, opts.id), refused: [...(app.refused || []), { id: opts.id, why: (error as Error).message.split("\n")[0] }].slice(-REFUSED) };
        return { error: error as Error };
      }
    });
    return app;
  });
  return answers;
}

/** The app with its newest change taken back. */
export async function undo(workspace: string, name: unknown): Promise<{ app: Json; undone: Json }> {
  let undone: Json;
  const app = await update(workspace, name, (app) => {
    undone = app.history[app.history.length - 1];
    if (!undone) throw new AppError(`${name} has no change left to undo`);
    return { ...app, data: undone.before, line: (app.line || 0) + 1, changed: now(), history: app.history.slice(0, -1) };
  });
  return { app, undone: undone! };
}

/** app.json's text: the definition as app.json holds it. */
export const definitionText = (app: Json): string => JSON.stringify(definitionOf(app), null, 2) + "\n";

/** app.json read from `text` (its JSON text, or an object): `definition`, its app.json keys, and
 *  with `withData` its `data`. Each problem is added to `problems`; `definition` is missing when
 *  `text` isn't an object at all. */
export function definitionFrom(text: unknown, problems: string[], withData = false): { definition?: Json; data?: Json } {
  let value: Json = text;
  if (typeof text === "string") {
    try {
      value = JSON.parse(text);
    } catch (e) {
      problems.push(`app.json isn't JSON: ${(e as Error).message}`);
      return {};
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    problems.push("app.json is an object");
    return {};
  }
  // A model sends one rule as a sentence rather than a list of one.
  if (typeof value.rules === "string") value = { ...value, rules: [value.rules] };
  const extra = Object.keys(value).filter((k) => !DEFINITION.includes(k) && !(withData && k === "data"));
  if (extra.length) problems.push(`app.json holds ${DEFINITION.join(", ")}; change the data with do, not ${extra.join(", ")}`);
  return { definition: definitionOf(value), ...(withData ? { data: value.data } : {}) };
}

/** The app's `file` as text: app.json, or page.html (null while it has none). */
const fileText = (app: Json, file: string): string | null => (file === "app.json" ? definitionText(app) : (app.page ?? null));

/** Refuses a `file` that isn't one of the app's own, to be read. */
function readableCheck(file: unknown): asserts file is string {
  if (["app.js", "app.css", "parts.js"].includes(file as string))
    throw new AppError(`${file} isn't one of the app's files: every page gets it inline. guide runtime explains App, guide styles is app.css, and guide <part> gives a part's code`);
  if (!FILES.includes(file as string)) throw new AppError(`file is ${FILES.join(" or ")}`);
}

/** One of the app's files as text: app.json, or page.html (null while it has none). */
export function readFile(workspace: string, name: unknown, file: unknown): string | null {
  readableCheck(file);
  return fileText(read(workspace, name), file);
}

/** `app` with one file replaced by `text` (null: no page.html), checked: app.json's keys, which its
 *  data must still fit, or page.html. */
async function withFile(app: Json, file: string, text: Json): Promise<Json> {
  const earlier: string[] = [];
  let next;
  if (file === "page.html") next = { ...app, page: text ?? undefined };
  else {
    const { definition } = definitionFrom(text, earlier);
    if (!definition) throw new AppError(earlier.join("; "));
    next = { ...Object.fromEntries(Object.entries(app).filter(([k]) => !DEFINITION.includes(k))), ...definition };
  }
  return checked({ ...next, changed: now() }, earlier, "saved", file === "page.html");
}

/** `app` with one file replaced, the file as it was kept for undo when it changed, and the ask it was
 *  changed for, if any, cleared. */
async function withVersion(app: Json, file: string, text: Json, ask?: unknown): Promise<Json> {
  const before = fileText(app, file);
  const next = cleared(await withFile(app, file, text), ask);
  if (fileText(next, file) !== before) next.versions = [...(app.versions || []), { t: next.changed, file, before }].slice(-VERSIONS);
  return next;
}

/** The app with one file replaced, and the file as it was kept for undo when it changed. */
export async function writeFile(workspace: string, name: unknown, file: unknown, text: Json, ask?: unknown): Promise<Json> {
  readableCheck(file);
  return update(workspace, name, (app) => withVersion(app, file, text, ask));
}

/** The app with the newest change to `file` (else to either file) taken back, and that change. */
export async function revert(workspace: string, name: unknown, file?: unknown): Promise<{ app: Json; reverted: Json }> {
  if (file !== undefined) readableCheck(file);
  let reverted: Json;
  const app = await update(workspace, name, async (app) => {
    const versions: Json[] = app.versions || [];
    const at = file === undefined ? versions.length - 1 : versions.map((v) => v.file).lastIndexOf(file);
    if (at < 0) throw new AppError(`${name} has no change to ${file || "app.json or page.html"} left to take back`);
    reverted = versions[at];
    return { ...(await withFile(app, reverted.file, reverted.before)), versions: [...versions.slice(0, at), ...versions.slice(at + 1)] };
  });
  return { app, reverted: reverted! };
}

/** The app with `find` in one file replaced, once, with `text`. */
export async function editFile(workspace: string, name: unknown, file: unknown, find: unknown, text: unknown, ask?: unknown): Promise<Json> {
  readableCheck(file);
  return update(workspace, name, (app) => {
    const was = fileText(app, file);
    if (was === null) throw new AppError(`${name} has no ${file} yet: write it whole with edit`);
    if (typeof find !== "string" || !find) throw new AppError("edit needs find: text the file holds");
    const at = was.indexOf(find);
    // The file as it is comes with the refusal, so the next try needs no read first.
    if (at < 0) throw new AppError(`${file} doesn't hold that text. It is now:\n${was}`);
    if (was.indexOf(find, at + 1) >= 0) throw new AppError(`${file} holds that text more than once; give more of it, so it's found exactly once`);
    return withVersion(app, file, was.slice(0, at) + String(text ?? "") + was.slice(at + find.length), ask);
  });
}

/** The app with `fields` outside its data and history set, such as its page's token. */
export const mark = (workspace: string, name: unknown, fields: Json): Promise<Json> => update(workspace, name, (app) => ({ ...app, ...fields }));

/** How many asks from an app's page wait for the chat, how many picks one holds, and how long its
 *  words may be. */
export const ASKS_WAITING = 10;
export const PICKS = 5;
export const ASK_TEXT = 500;

/** An ask from the app's page: what the user picked on it ("Change this") and what they want of
 *  each, kept apart from the data and its history until the agent clears it. Refused when it's
 *  malformed, or when ASKS_WAITING already wait. */
export async function addAsk(workspace: string, name: unknown, ask: { event?: string; picks: Json }): Promise<{ id: string; kept: number } | null> {
  const picks = Array.isArray(ask.picks) ? ask.picks.slice(0, PICKS) : [];
  const clip = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : undefined);
  const clean = picks
    .map((p: Json) => ({ id: clip(p?.id, 80), ref: clip(p?.ref, 80), part: clip(p?.part, 80), at: clip(p?.at, 200), figure: clip(p?.figure, 40), tag: clip(p?.tag, 20), cls: clip(p?.cls, 60), shown: clip(p?.shown, 80), text: clip(p?.text, ASK_TEXT) }))
    .filter((p: Json) => p.text);
  if (!clean.length) throw new AppError("an ask says what should change of something picked on the page");
  const app = await update(workspace, name, (app) => {
    // A page may send an ask twice: it's kept once, as a change is.
    if (isSeen(app, ask.event)) return { ...app, duplicate: true };
    const asks: Json[] = app.asks || [];
    if (asks.length >= ASKS_WAITING) throw new AppError(`${ASKS_WAITING} asks are waiting already: the chat has to catch up first`);
    const seq = (app.askSeq || 0) + 1;
    const next = { ...app, askSeq: seq, asks: [...asks, { id: `a${seq}`, t: now(), picks: clean }] };
    return ask.event ? seenWith(next, ask.event) : next;
  });
  return app.duplicate ? null : { id: app.asks.at(-1).id, kept: clean.length };
}

/** The app with a secret for its page's events, made now for an app from before apps had one. */
export const withSecret = (workspace: string, name: unknown): Promise<Json> => update(workspace, name, (app) => (app.secret ? app : { ...app, secret: newSecret() }));

/** The workspaces that have apps. */
export function workspaces(): string[] {
  try {
    return fs.readdirSync(root(), { withFileTypes: true }).filter((d) => d.isDirectory() && WORKSPACE.test(d.name)).map((d) => d.name);
  } catch {
    return [];
  }
}

/** How many deleted apps the trash keeps, the newest. */
export const TRASH_KEPT = 20;
const trash = (): string => path.join(root(), ".trash");

/** Takes the app out of its workspace into the trash, which keeps the newest TRASH_KEPT: a delete
 *  the user didn't mean can be put back by hand. */
export async function remove(workspace: string, name: unknown): Promise<void> {
  return withLock(workspace, name, () => {
    read(workspace, name);
    fs.mkdirSync(trash(), { recursive: true });
    // Named by when it was deleted, to the millisecond, so the trash's names sort oldest first.
    fs.renameSync(fileOf(workspace, name), path.join(trash(), `${String(Date.now()).padStart(13, "0")}-${workspace}-${name}.json`));
    const kept = fs.readdirSync(trash()).filter((f) => f.endsWith(".json")).sort();
    for (const f of kept.slice(0, Math.max(0, kept.length - TRASH_KEPT))) fs.rmSync(path.join(trash(), f), { force: true });
  });
}
