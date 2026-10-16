// The logins the browser signs in with, kept in the instance's vault (#shared/vault), which the
// model never reads: a site, a username and its password (kind "password"). Shared by every
// workspace, as the library's keys are.
//
// The lean browser kept a vault per workspace (<storage>/browser-lean/<workspace>/vault.json, under
// a key of its own). Its logins, passkeys (kept for when the browser signs in with them again) and
// API keys (the library's now) are imported once, without one already there; its OAuth sign-ins
// aren't (the library signs in its own way). Its files are left as they were.

import fs from "node:fs";
import path from "node:path";
import { onSite } from "#shared/fence";
import * as vault from "#shared/vault";
import { skillDir, state } from "./state";

const KIND = "password";

export interface Login {
  id: string;
  site: string;
  user: string;
  pass: string;
}

/** The saved logins, without their passwords. */
export const list = (): { id: string; site: string; user: string }[] =>
  vault
    .entries()
    .filter((e) => e.kind === KIND)
    .map(({ id, site, user }) => ({ id, site, user }));

/** The login for `host` (its site or a parent's; the closest wins), password and all; null when
 *  there's none. With `kind` "passkey", whether a passkey is saved for it. */
export function forHost(host: string, kind = KIND): Login | null {
  const matching = vault.entries().filter((e) => e.kind === kind && onSite(host, e.site));
  const found = [...matching].sort((a, b) => b.site.length - a.site.length)[0];
  return found ? { id: found.id, site: found.site, user: found.user, pass: String(found.pass ?? "") } : null;
}

/** Saves a login, replacing the one for the same site and username. */
export const save = (site: string, user: string, pass: string): Promise<void> =>
  vault.update((v) => {
    const at = v.entries.findIndex((e) => e.kind === KIND && e.site === site && e.user === user);
    if (at >= 0) v.entries[at] = { ...v.entries[at], pass };
    else v.entries.push({ id: vault.newId(), kind: KIND, site, user, pass });
  });

/** Deletes a login; whether there was one. */
export const remove = (id: string): Promise<boolean> =>
  vault.update((v) => {
    const before = v.entries.length;
    v.entries = v.entries.filter((e) => !(e.kind === KIND && e.id === id));
    return v.entries.length < before;
  });

const LEAN_INFO = "browser-lean vault";
const LEAN_KINDS = new Set(["password", "passkey", "key"]);

/** The same secret: a login or passkey of the same kind, site and user; a key of the same name. */
const same = (a: vault.Entry, b: vault.Entry) =>
  a.kind === b.kind && (a.kind === "key" ? a.user.toLowerCase() === b.user.toLowerCase() : a.site === b.site && a.user === b.user);

/** Imports the lean browser's vaults once (a marker says it's done); answers how many entries came.
 *  A vault that can't be opened is skipped and said in `log`. */
export async function importLean(log: (message: string) => void = () => {}): Promise<number> {
  const marker = path.join(skillDir(), ".imported");
  if (state().imported || fs.existsSync(marker) || !fs.existsSync(skillDir())) return void (state().imported = true), 0;
  const found: vault.Entry[] = [];
  for (const ws of fs.readdirSync(skillDir(), { withFileTypes: true })) {
    const file = path.join(skillDir(), ws.name, "vault.json");
    if (!ws.isDirectory() || !fs.existsSync(file)) continue;
    try {
      const opened = vault.openLegacy(file, LEAN_INFO, path.join(skillDir(), "vault.key")) as { logins?: vault.Entry[] } | null;
      found.push(...(opened?.logins ?? []).map((l) => ({ ...l, kind: l.kind || KIND })).filter((e) => LEAN_KINDS.has(e.kind)));
    } catch (e) {
      log(`browser-lean couldn't import the logins of ${ws.name}: ${(e as Error).message}`);
    }
  }
  const added = !found.length ? 0 : await vault.update((v) => {
    let n = 0;
    for (const e of found) {
      if (v.entries.some((x) => same(x, e))) continue;
      const { writes, ...kept } = e; // a key's "let the agent change things", which the library doesn't keep
      v.entries.push({ ...kept, id: vault.newId() });
      n++;
    }
    return n;
  });
  fs.writeFileSync(marker, new Date().toISOString() + "\n");
  state().imported = true;
  return added;
}
