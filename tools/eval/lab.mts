// The test lab (tools/lab), as the eval sees it: through the lab's own modules on its database (the
// running lab's, by default), not through its pages. Each case gets accounts of its own, so a run
// never takes another tester's codes; what to type comes from here (codes, a captcha's digits), and
// whether a case worked comes from the lab's records, not from what the agent says.

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { ROOT } from "./instance.mts";

export const LAB_DIR = process.env.LAB_DIR || path.join(ROOT, "tools/lab");
const require = createRequire(path.join(LAB_DIR, "package.json"));
const { authenticator } = require("otplib");
const users = await import(path.join(LAB_DIR, "src/lib/users.js"));
const push = await import(path.join(LAB_DIR, "src/lib/push.js"));
const { db } = await import(path.join(LAB_DIR, "src/lib/db.js"));

/** A site's public address: LAB_PUBLIC_URL (from the environment, else the lab's .env) with {name}. */
export function urlOf(site: string): string {
  const fromEnv = process.env.LAB_PUBLIC_URL || fs.readFileSync(path.join(LAB_DIR, ".env"), "utf8").match(/^LAB_PUBLIC_URL=(.*)$/m)?.[1]?.trim();
  if (!fromEnv) throw new Error("tools/eval: set LAB_PUBLIC_URL (https://lab-{name}.example.com): the browser reaches the lab by its public names");
  return fromEnv.replace("{name}", site);
}

export interface Account {
  site: string;
  email: string;
  pass: string;
  name: string;
  phone: string;
  /** The authenticator's secret, on the sites that ask for a code from one. */
  totp?: string;
}

/** Sites whose accounts have an authenticator, and the one whose accounts have no password. */
const TOTP_SITES = new Set(["totp", "stepup", "push"]);
const NO_PASSWORD = new Set(["otp"]);
const PHONE_SITES = new Set(["otp"]);
/** What a new account on a site holds besides the login, as its own seed gives Alice. */
const PROFILE: Record<string, object> = {
  basic: { notes: ["Water the ferns", "Book the dentist"] },
  spa: { tasks: [{ title: "Plan the picnic", done: false }] },
  wizard: { country: "Canada", style: "leisure", dob: "1990-04-12", newsletter: false },
};

/** A new account on `site` for one case of a run; `tag` makes its email unique (eval-<tag>@lab.test).
 *  With `create` false, only its details: for a case that signs up. */
export function account(site: string, tag: string, create = true): Account {
  const a: Account = {
    site,
    email: `eval-${tag}@lab.test`.toLowerCase().replace(/[^a-z0-9@.-]/g, "-"),
    pass: `Ev-${Math.random().toString(36).slice(2, 10)}-1`,
    name: "Eve Valdez",
    phone: `+1555${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`,
    totp: TOTP_SITES.has(site) ? authenticator.generateSecret() : undefined,
  };
  // A phone only where the site texts codes: elsewhere it changes the account page's layout, which a
  // case that taps the tab's picture (passkey-add) depends on.
  if (create) users.create(site, { email: a.email, name: a.name, pass: NO_PASSWORD.has(site) ? null : a.pass, phone: PHONE_SITES.has(site) ? a.phone : null, totp: a.totp ?? null, profile: PROFILE[site] ?? null });
  return a;
}

/** Removes a run's accounts (eval-<run>-…), with their sessions, codes, phone approvals and passkeys. */
export function removeRun(run: string): number {
  const gone = db.prepare("SELECT id, email, phone FROM users WHERE email LIKE ?").all(`eval-${run.toLowerCase()}-%`) as { id: number; email: string; phone: string }[];
  const ids = new Set(gone.map((u) => u.id));
  for (const s of db.prepare("SELECT id, data FROM sessions").all() as { id: string; data: string }[]) {
    if (ids.has(JSON.parse(s.data).userId)) db.prepare("DELETE FROM sessions WHERE id = ?").run(s.id);
  }
  for (const u of gone) {
    db.prepare("DELETE FROM outbox WHERE recipient IN (?, ?)").run(u.email, u.phone ?? "");
    db.prepare("DELETE FROM pushes WHERE user_id = ?").run(u.id);
    db.prepare("DELETE FROM users WHERE id = ?").run(u.id); // passkeys go with it
  }
  return gone.length;
}

/** The code the tab's page asks for, by its wording: the authenticator's now, else the latest unused
 *  one the site sent to the account's phone or email (either, when the wording doesn't say, as the
 *  person would look in both). */
export function codeFor(a: Account, asked: string): string {
  if (/authenticator/i.test(asked)) return a.totp ? authenticator.generate(a.totp) : "";
  const to = /phone|sms|text/i.test(asked) ? [a.phone] : /email/i.test(asked) ? [a.email] : [a.email, a.phone];
  const row = db.prepare("SELECT code FROM outbox WHERE site = ? AND recipient IN (?, ?) AND used = 0 ORDER BY id DESC LIMIT 1").get(a.site, to[0] ?? "", to[1] ?? to[0] ?? "") as { code: string } | undefined;
  return row?.code ?? "";
}

/** The digits of the captcha the site drew last. */
export function captcha(site = "captcha"): string {
  for (const s of db.prepare("SELECT data FROM sessions WHERE site = ? ORDER BY created DESC").all(site) as { data: string }[]) {
    const d = JSON.parse(s.data);
    if (d.captcha) return String(d.captcha);
  }
  return "";
}

/** Approves the account's waiting sign-in on its phone; false when none waits. */
export function approvePush(a: Account): boolean {
  const user = users.byEmail(a.site, a.email);
  const waiting = user && (push.pending() as { number: number; email: string }[]).find((p) => p.email === a.email);
  return waiting ? push.approve(waiting.number) : false;
}

/** Whether `email` was signed in on `site` since `since` (an ISO time): a session the lab made for it. */
export function signedIn(site: string, email: string, since: string): boolean {
  const user = users.byEmail(site, email);
  if (!user) return false;
  const after = since.replace("T", " ").slice(0, 19);
  return (db.prepare("SELECT data FROM sessions WHERE site = ? AND created >= ?").all(site, after) as { data: string }[]).some((s) => JSON.parse(s.data).userId === user.id);
}

export const exists = (site: string, email: string): boolean => !!users.byEmail(site, email);
