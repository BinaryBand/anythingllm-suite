// A workspace's browser sessions, its cookies, kept in the vault: Chrome runs with a profile made
// for it in a temporary folder, and what it's signed in to is saved here (encrypted with the
// vault's key) and given back when it starts again. A profile kept in the storage held cookies
// that anyone reading the folder could use. Partitioned cookies and what sites keep elsewhere
// (localStorage, IndexedDB) aren't kept: a site that keeps its sign-in there signs in again, with
// the saved login.

import crypto from "node:crypto";
import * as vault from "#shared/vault";
import type { CDPSession, Page } from "./host";

const KIND = "session";
/** What Network.setCookies takes of what Network.getAllCookies gives, besides expires. */
const FIELDS = ["name", "value", "domain", "path", "secure", "httpOnly", "sameSite", "priority", "sourceScheme", "sourcePort"];

type Cookie = Record<string, unknown>;

async function withSession<T>(page: Page, fn: (cdp: CDPSession) => Promise<T>): Promise<T> {
  const cdp = await page.target().createCDPSession();
  try {
    return await fn(cdp);
  } finally {
    await cdp.detach().catch(() => {});
  }
}

/** The cookies worth keeping, as setCookies takes them, in a stable order: not run out, not
 *  partitioned; one that ends with the browser (session) is kept too, so a sign-in lasts. */
export function keepable(cookies: Cookie[], now = Date.now() / 1000): Cookie[] {
  return cookies
    .filter((c) => !c.partitionKey && (c.session || !(Number(c.expires) > 0) || Number(c.expires) > now))
    .map((c) => {
      const kept: Cookie = Object.fromEntries(FIELDS.filter((f) => c[f] !== undefined).map((f) => [f, c[f]]));
      if (!c.session && Number(c.expires) > 0) kept.expires = c.expires;
      return kept;
    })
    .sort((a, b) => `${a.domain}\0${a.path}\0${a.name}`.localeCompare(`${b.domain}\0${b.path}\0${b.name}`));
}

const digest = (cookies: Cookie[]): string => crypto.createHash("sha256").update(JSON.stringify(cookies)).digest("hex");

/** Gives a newly started browser the workspace's saved cookies, through `page`; answers what's
 *  saved now, to compare a later save with. */
export async function restore(workspace: string, page: Page): Promise<string> {
  const saved = vault.entries().find((e) => e.kind === KIND && e.site === workspace);
  const cookies = keepable((saved?.cookies as Cookie[] | undefined) ?? []);
  if (cookies.length) await withSession(page, (cdp) => cdp.send("Network.setCookies", { cookies }));
  return digest(cookies);
}

/** Saves the browser's cookies for the workspace, read through `page`, unless they're what `last`
 *  says was saved; answers what's saved now. */
export async function save(workspace: string, page: Page, last: string | null): Promise<string> {
  const { cookies } = (await withSession(page, (cdp) => cdp.send("Network.getAllCookies"))) as { cookies: Cookie[] };
  const kept = keepable(cookies);
  const now = digest(kept);
  if (now === last) return now;
  await vault.update((v) => {
    v.entries = v.entries.filter((e) => !(e.kind === KIND && e.site === workspace));
    if (kept.length) v.entries.push({ id: vault.newId(), kind: KIND, site: workspace, user: "", cookies: kept });
  });
  return now;
}
