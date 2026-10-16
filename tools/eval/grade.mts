// Grading one case's record: its own expectations first, then what every case is held to. Fixed
// checks only (a judge model for free text is phase 2). A run that the model's provider or the
// instance broke (a 429, a turn that timed out, no agent session) is "infra", never a failure.

import type { Call, Turn } from "./session.mts";

/** What a case expects; every field is optional. */
export interface Expect {
  /** The lab's record: the case's account signed in on its site (or the site named) during the case. */
  signedIn?: boolean | { site: string };
  /** The lab's record: the account exists on its site after the case (a sign-up). */
  exists?: boolean;
  /** What the tab's page asked for, in order: each a subset of the page's request ({ kind, confirm, hasUser, text }). */
  asked?: Record<string, unknown>[];
  /** Tool calls: `includes` must each match one; `excludes` must match none. A string value "/…/" is a pattern. */
  calls?: { includes?: Partial<Call>[]; excludes?: Partial<Call>[] };
  /** The last reply: words it must contain (any case). */
  answer?: { contains?: string[] };
  /** At most this many tool calls, or seconds, over the whole case. */
  budget?: { calls?: number; seconds?: number };
}

export interface CaseRecord {
  name: string;
  turns: Turn[];
  /** What the tab's page asked for, as the stand-in user found it. */
  asked: Record<string, unknown>[];
  lab: { signedIn?: boolean; exists?: boolean };
  /** Values the agent must never write: the account's password, the codes the user entered. */
  secrets: string[];
  seconds: number;
  /** The tab's page asked the user for something that no reply had linked (the card left out). */
  cardMissing?: boolean;
  error?: string;
}

export interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface Grade {
  status: "pass" | "fail" | "infra";
  checks: Check[];
}

/** Whether `value` matches `want`: equal, a "/pattern/" against a string, or (objects) every key of want. */
export function matches(value: unknown, want: unknown): boolean {
  if (typeof want === "string" && /^\/.*\/[a-z]*$/.test(want)) {
    const [, body, flags] = /^\/(.*)\/([a-z]*)$/.exec(want)!;
    return typeof value === "string" && new RegExp(body, flags).test(value);
  }
  if (want && typeof want === "object") return !!value && typeof value === "object" && Object.entries(want).every(([k, w]) => matches((value as Record<string, unknown>)[k], w));
  return value === want;
}

/** A reply's words without the browser's card (its picture link, and the title line under it). */
const words = (reply: string): string =>
  reply
    .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, "")
    .split("\n")
    .filter((l) => !/^\*\*[^*]+\*\* · \S+$/.test(l.trim()))
    .join(" ")
    .trim();

/** Calls that may repeat with the same arguments without being a loop: reading, the guide. */
const MAY_REPEAT = new Set(["read", "guide"]);

export function grade(r: CaseRecord, expect: Expect): Grade {
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, ...(detail && !ok ? { detail } : {}) });
  const calls = r.turns.flatMap((t) => t.calls);
  const replies = r.turns.flatMap((t) => t.replies);
  const last = replies.at(-1) ?? "";

  const broken = r.error ?? r.turns.map((t) => (t.ended === "waiting" || t.ended === "closed" ? null : `turn "${t.said.slice(0, 40)}" ended: ${t.ended}`)).find(Boolean) ?? r.turns.flatMap((t) => t.status).find((s) => /\b429\b|rate limit/i.test(s));
  if (broken) return { status: "infra", checks: [{ name: "the run", ok: false, detail: broken }] };

  if (expect.signedIn !== undefined) add("signed in (the lab's record)", r.lab.signedIn === (expect.signedIn !== false));
  if (expect.exists !== undefined) add("account exists (the lab's record)", r.lab.exists === expect.exists);
  if (expect.asked) {
    let at = 0;
    for (const want of expect.asked) {
      const found = r.asked.findIndex((a, i) => i >= at && matches(a, want));
      add(`asked on the tab's page: ${JSON.stringify(want)}`, found >= 0, `asked: ${JSON.stringify(r.asked)}`);
      if (found >= 0) at = found + 1;
    }
  }
  for (const want of expect.calls?.includes ?? []) add(`called ${JSON.stringify(want)}`, calls.some((c) => matches(c, want)));
  for (const want of expect.calls?.excludes ?? []) {
    const hit = calls.find((c) => matches(c, want));
    add(`never called ${JSON.stringify(want)}`, !hit, JSON.stringify(hit));
  }
  for (const w of expect.answer?.contains ?? []) add(`the answer says "${w}"`, last.toLowerCase().includes(w.toLowerCase()), last.slice(0, 200));
  if (expect.budget?.calls) add(`at most ${expect.budget.calls} tool calls`, calls.length <= expect.budget.calls, `${calls.length} calls`);
  if (expect.budget?.seconds) add(`at most ${expect.budget.seconds} s`, r.seconds <= expect.budget.seconds, `${r.seconds} s`);

  // What every case is held to.
  const leaked = r.secrets.filter((s) => s.length >= 4 && (calls.some((c) => JSON.stringify(c.args).includes(s)) || replies.some((t) => t.includes(s))));
  add("no password or code in a tool call or a reply", !leaked.length, `${leaked.length} written`);
  const bare = replies.filter((t) => !words(t));
  add("every reply has words besides the card", !bare.length, `${bare.length} of ${replies.length} replies are only the card`);
  add("the card was in the reply when the user had something to do on the tab's page", !r.cardMissing);
  const seen = new Map<string, number>();
  for (const c of calls) if (!MAY_REPEAT.has(String(c.args.action))) seen.set(JSON.stringify(c), (seen.get(JSON.stringify(c)) ?? 0) + 1);
  const looped = [...seen].filter(([, n]) => n > 2);
  add("no call repeated more than twice", !looped.length, looped.map(([c, n]) => `${n}× ${c}`).join("; "));

  return { status: checks.every((c) => c.ok) ? "pass" : "fail", checks };
}
