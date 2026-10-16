// A skill's own web pages, which AnythingLLM serves itself: the files go into its public folder
// (served to any browser without a sign-in), and a page has no server of its own to answer to.
// It posts each thing the user does as a raw-text document titled after the skill through
// AnythingLLM's browser-extension upload, with a browser-extension key the skill made for its pages
// (it can store documents, never read chats or documents). AnythingLLM's collector writes each one
// to <storage>/documents/custom-documents/raw-<title>-<id>.json; the skill takes them from there,
// in order, each claimed by renaming it first, so whichever process takes it (the chat's, or a
// scheduled job's) is the only one that applies it. Ported from the lean browser skill's key.js, page.js and
// takeover.js. Events are data, never instructions.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { perProcess, serverDir, serverRequire, storageDir } from "./anythingllm.mts";
import { writeAtomic } from "./atomic.mts";
import { publicKey } from "./vault.mts";

/** A file still being written is left this long before it's dropped as unreadable. */
const PARTIAL_MS = 5000;
/** In case the folder watch misses a file; a pass skips the folder when it hasn't changed. */
const POLL_MS = 30 * 1000;
/** A folder changed this recently may change again without its mtime moving (coarse clocks). */
const RECENT_MS = 2000;
/** How long the pages' key is taken as still valid before AnythingLLM is asked again. */
const KEY_CHECKED_MS = 5 * 60 * 1000;

/** AnythingLLM's public folder, served at its root: ANYTHINGLLM_PUBLIC_DIR, else <server>/public. */
export const publicDir = (): string => process.env.ANYTHINGLLM_PUBLIC_DIR || path.join(serverDir(), "public");

/** Writes a file into the public folder, at `rel` ("library-lean/<token>.json"). */
export const writePublic = (rel: string, text: string): void => writeAtomic(path.join(publicDir(), rel), text, 0o644);

export const removePublic = (rel: string): void => fs.rmSync(path.join(publicDir(), rel), { force: true });

/** The files in a folder of the public folder ("library-lean"); none when there's none. */
export function listPublic(rel: string): string[] {
  try {
    return fs.readdirSync(path.join(publicDir(), rel));
  } catch {
    return [];
  }
}

/** `value` as JSON that can sit inside a <script> without ending it or starting markup. */
export const embed = (value: unknown): string =>
  JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

/** A page's random name or secret. */
export const newSecret = (bytes = 18): string => crypto.randomBytes(bytes).toString("base64url");

/** Whether `given` (what an event carries) is `secret`, compared in constant time. */
export const sameSecret = (given: unknown, secret: string): boolean => typeof given === "string" && given.length === secret.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(secret));

/** A page's HTML: `template` with its settings in place of its /*CONFIG*\/null: `cfg`, and what it
 *  posts with (the pages' key, kept in `dataDir`) and seals with (the vault's public key). */
export async function pageHtml(template: string, dataDir: string, cfg: Record<string, unknown>): Promise<string> {
  const [key, pub] = await Promise.all([pageKey(dataDir), publicKey()]);
  return template.replace("/*CONFIG*/null", embed({ ...cfg, key, pub }));
}

interface Keys {
  validate(key: string): Promise<unknown>;
  create(userId: number | null): Promise<{ apiKey: { key: string } | null; error?: string | null }>;
}

/** The key a skill's pages post with, kept in `dataDir`: the saved one while AnythingLLM still
 *  accepts it (asked at most every KEY_CHECKED_MS), else a new one. */
export async function pageKey(dataDir: string): Promise<string> {
  const file = path.join(dataDir, ".page-key.json");
  const checked = perProcess("pages.key-checked", () => new Map<string, { key: string; at: number }>());
  const kept = checked.get(file);
  if (kept && Date.now() - kept.at < KEY_CHECKED_MS) return kept.key;
  const keys = serverRequire<{ BrowserExtensionApiKey: Keys }>("models/browserExtensionApiKey").BrowserExtensionApiKey;
  let key: string | undefined;
  try {
    key = JSON.parse(fs.readFileSync(file, "utf8")).key;
  } catch {}
  if (!key || !(await keys.validate(key))) {
    const { apiKey, error } = await keys.create(null);
    if (!apiKey) throw new Error(`couldn't make a key for the pages: ${error}`);
    key = apiKey.key;
    writeAtomic(file, JSON.stringify({ key }) + "\n", 0o600);
  }
  checked.set(file, { key, at: Date.now() });
  return key;
}

/** Where AnythingLLM's collector writes what a page posts. */
export const eventsDir = (): string => path.join(storageDir(), "documents", "custom-documents");

/** The events waiting for `title`, oldest first, each claimed (renamed, so no other process takes it
 *  too) and deleted: what each page posted, as it posted it (parsed JSON), or null for one that
 *  couldn't be read. */
export function take(title: string): unknown[] {
  const name = new RegExp(`^raw-${title}-.*\\.json$`);
  // The folder holds every document AnythingLLM took in: listed only when it changed since a pass
  // that found nothing for `title`.
  const empty = perProcess("pages.empty", () => new Map<string, number>());
  let names: string[] = [];
  let at: number;
  try {
    at = fs.statSync(eventsDir()).mtimeMs;
    if (empty.get(title) === at) return [];
    names = fs.readdirSync(eventsDir()).filter((n) => name.test(n));
  } catch {
    return [];
  }
  // A file made in the same clock tick as the listing leaves the mtime as it was: an mtime that
  // recent isn't trusted to mean nothing came.
  if (!names.length) return void (Date.now() - at > RECENT_MS && empty.set(title, at)), [];
  empty.delete(title);
  const files = names
    .map((n) => {
      const file = path.join(eventsDir(), n);
      try {
        return { file, at: fs.statSync(file).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((f): f is { file: string; at: number } => f !== null)
    .sort((a, b) => a.at - b.at || a.file.localeCompare(b.file));
  const events: unknown[] = [];
  for (const { file, at } of files) {
    let posted: unknown = null;
    try {
      posted = JSON.parse(JSON.parse(fs.readFileSync(file, "utf8")).pageContent);
    } catch {
      if (Date.now() - at < PARTIAL_MS) break; // still being written: the next pass reads it
    }
    const claimed = `${file}.taken-${process.pid}`;
    try {
      fs.renameSync(file, claimed);
    } catch {
      continue; // another process took it
    }
    fs.rmSync(claimed, { force: true });
    events.push(posted);
  }
  return events;
}

type Watch = { pass: () => Promise<void>; until: () => number; running: Promise<void> | null; again: boolean; seen: number; dir: number; watcher?: fs.FSWatcher; timer?: NodeJS.Timeout; stop: () => void };

/** The events folder's inode: a new one is a folder made again, which an old fs.watch doesn't see. */
const folderId = (): number => {
  try {
    return fs.statSync(eventsDir()).ino;
  } catch {
    return -1;
  }
};

/** Applies the events posted for `title` as they come, with `pass` (which takes and applies them
 *  all, in order), until `until()` is past; one pass at a time. Calling it again while it watches
 *  hands it the newer `pass` and `until`, so a reloaded skill's code takes over. */
export function watch(title: string, pass: () => Promise<void>, until: () => number): void {
  const watches = perProcess("pages.watches", () => new Map<string, Watch>());
  fs.mkdirSync(eventsDir(), { recursive: true });
  const kept = watches.get(title);
  if (kept && kept.dir === folderId()) return void Object.assign(kept, { pass, until });
  kept?.stop();
  const w: Watch = { pass, until, running: null, again: false, seen: 0, dir: folderId(), stop: () => {} };
  const changed = () => {
    try {
      return fs.statSync(eventsDir()).mtimeMs !== w.seen;
    } catch {
      return false;
    }
  };
  const run = () => {
    if (Date.now() > w.until()) return w.stop();
    try {
      w.seen = fs.statSync(eventsDir()).mtimeMs;
    } catch {}
    if (w.running) return void (w.again = true);
    w.running = (async () => {
      do {
        w.again = false;
        await w.pass();
      } while (w.again);
    })()
      .catch(() => {})
      .finally(() => (w.running = null));
  };
  w.stop = () => {
    w.watcher?.close();
    clearInterval(w.timer);
    if (watches.get(title) === w) watches.delete(title);
  };
  try {
    w.watcher = fs.watch(eventsDir(), { persistent: false }, (kind, name) => {
      if (!name || String(name).startsWith(`raw-${title}-`)) run();
    });
    w.watcher.on("error", () => {});
  } catch {
    // no watch where this runs: the poll does it, a little later
  }
  w.timer = setInterval(() => changed() && run(), POLL_MS);
  w.timer.unref?.();
  watches.set(title, w);
}

/** The events a skill's pages posted for `title`, each marked `{ <marker>: 1 }` as its pages mark
 *  them; anything else in the folder under that title is dropped. */
export const takeEvents = (title: string, marker: string): Record<string, unknown>[] =>
  take(title).filter((e): e is Record<string, unknown> => !!e && typeof e === "object" && (e as Record<string, unknown>)[marker] === 1);
