// What the memory keeps. A fact is one short line about the user, in the scope GLOBAL (every
// workspace) or a workspace's slug; its id is shown as `m12`. The values a call names things by
// are checked here, and each refusal tells the agent what to give instead.

/** GLOBAL, or a workspace's slug. */
export type Scope = string;

export interface Fact {
  id: number;
  scope: Scope;
  text: string;
  kind: string;
  tags: string[];
  /** How many times the text has been written; part of the fact's vector document id. */
  rev: number;
  updated: string;
  history: { text: string; at: string }[];
}

export interface Index {
  next: number;
  /** For each scope, what its vectors were made with (vectors.ts's fingerprint). */
  synced: Record<Scope, string>;
  facts: Fact[];
}

export const GLOBAL = "_global"; // not a slug, so no workspace can be mistaken for it
const MAX_FACT = 500; // characters in one fact
export const MAX_FACTS = 2000; // per scope: a changed embedder embeds every fact again
export const LIST_FACTS = 50; // the newest facts `list` shows
const MAX_QUERY = 300;
const DEFAULT_K = 5;
const MAX_K = 20;
const MAX_TAGS = 5;
export const KEPT_REVISIONS = 5; // old texts of a fact kept in the index
// From this cosine a new fact is *said* to be like a kept one, never acted on: a score can't tell
// "Son is 7" from "Daughter is 7". The scale is the embedder's own, so the number is a guess.
export const SIMILAR = 0.85;
const KINDS = ["profile", "preference", "project", "person", "event", "other"];

/** What a tool tells the agent when it can't do what was asked. */
export class MemoryError extends Error {}

/** `s` as one line of text: whitespace single, control and invisible characters (bidi marks,
 *  zero-width spaces) dropped, no ends. */
export const clean = (s: unknown): string =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .replace(/[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Cn}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

function oneLine(value: unknown, what: string, most: number): string {
  const line = clean(value);
  if (!line) throw new MemoryError(`${what} is empty`);
  if (line.length > most) throw new MemoryError(`${what} is ${line.length} characters, over ${most}; shorten it`);
  return line;
}

export const factText = (value: unknown): string => oneLine(value, "the fact", MAX_FACT);
export const queryText = (value: unknown): string => oneLine(value, "the query", MAX_QUERY);

/** A fact's id from `m12` or 12. */
export function factId(value: unknown): number {
  const m = /^m?(\d+)$/i.exec(clean(value));
  if (!m || Number(m[1]) < 1) throw new MemoryError("give the fact's id as shown, like m12");
  return Number(m[1]);
}

/** Up to MAX_TAGS short lowercase tags, from a list or a comma-separated text. */
export function factTags(value: unknown): string[] {
  const list: unknown[] = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const tags = [...new Set(list.map((t) => clean(t).toLowerCase().replace(/ /g, "-")).filter(Boolean))];
  if (tags.length > MAX_TAGS || !tags.every((t) => /^[a-z0-9][a-z0-9_-]{0,29}$/.test(t))) {
    throw new MemoryError(`give at most ${MAX_TAGS} tags, each one short word`);
  }
  return tags;
}

export function factKind(value: unknown): string {
  const kind = clean(value).toLowerCase() || "other";
  if (!KINDS.includes(kind)) throw new MemoryError(`kind is one of ${KINDS.join(", ")}`);
  return kind;
}

export function factCount(value: unknown): number {
  if (value === undefined || value === null || value === "") return DEFAULT_K;
  const k = Number(value);
  if (!Number.isInteger(k) || k < 1 || k > MAX_K) throw new MemoryError(`k is how many to recall, 1 to ${MAX_K}`);
  return k;
}

export { flag } from "#shared/answer";

/** The scope a call names: "global", or "workspace" for the one the call came from; null when
 *  none is named. Never taken from a workspace name the model makes up. */
export function scopeOf(value: unknown, workspace: string | null): Scope | null {
  const named = clean(value).toLowerCase();
  if (!named) return null;
  if (named === "global") return GLOBAL;
  if (named === "workspace" || named === "this" || (workspace && named === workspace)) {
    if (!workspace) throw new MemoryError("this call has no workspace; use scope global");
    return workspace;
  }
  throw new MemoryError("scope is `global` (what holds everywhere, the default) or `workspace` (this workspace only)");
}

/** The scopes a fact in `scope` is seen with: its own and global. */
export const scopesOf = (scope: Scope): Scope[] => (scope === GLOBAL ? [GLOBAL] : [scope, GLOBAL]);

/** The scopes a read sees: the one named, else the call's workspace's and global. */
export function visible(value: unknown, workspace: string | null): Scope[] {
  const named = scopeOf(value, workspace);
  return named ? [named] : scopesOf(workspace || GLOBAL);
}
