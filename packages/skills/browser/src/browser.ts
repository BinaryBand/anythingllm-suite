// Chrome, run by this skill inside AnythingLLM's own process: the Puppeteer and the Chrome that
// AnythingLLM's collector ships with, required at run time, so the skill brings none of its own.
// Each workspace gets a browser of its own with a profile in AnythingLLM's storage, so its logins
// last; each chat thread gets a tab. A browser closes after IDLE_MS unused, and at most
// MAX_BROWSERS run at once. Every request a page makes goes through the fence (#shared/fence), and
// every tab has a passkey authenticator (passkey.ts).
// What must outlive a reload (the browsers, their tabs) is kept per process (state.ts).

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { FENCED, makeFence } from "#shared/fence";
import { ACT_MS, NAVIGATE_MS, settle } from "./act";
import { BrowserError } from "./errors";
import type { Browser, Page, Puppeteer } from "./host";
import { forgetTab, redraw } from "./page";
import * as passkey from "./passkey";
import { type Entry, type Tab, VIEWPORT, firstLine, note, state, threadKey, workspaceDir } from "./state";

const PUPPETEER = "/app/collector/node_modules/puppeteer";
const IDLE_MS = 20 * 60 * 1000;
const MAX_BROWSERS = 3;
/** The screen a research page reads at, so docs show their desktop layout. */
const DESKTOP = { width: 1280, height: 900, deviceScaleFactor: 1 };
const ARGS = ["--no-sandbox", "--disable-dev-shm-usage", "--no-first-run", "--no-default-browser-check", "--disable-features=Translate,MediaRouter", "--password-store=basic"];
/** Chrome's own password saving, off in every profile the skill makes. */
const PREFERENCES = { credentials_enable_service: false, profile: { password_manager_enabled: false } };

/** AnythingLLM's collector's Puppeteer (BROWSER_LEAN_PUPPETEER, else where its image has it),
 *  required by a path built at run time, so esbuild leaves it alone. */
function puppeteer(): Puppeteer {
  const tried = [process.env.BROWSER_LEAN_PUPPETEER, PUPPETEER].filter((p): p is string => !!p);
  for (const where of tried) {
    try {
      return createRequire(path.join(process.cwd(), "index.js"))(where) as Puppeteer;
    } catch {
      // the next place
    }
  }
  throw new BrowserError(`this AnythingLLM has no Puppeteer the browser can use (looked in ${tried.join(", ")}); set BROWSER_LEAN_PUPPETEER in AnythingLLM's environment to one`);
}

/** Takes the lock of a Chrome that's gone (AnythingLLM restarted under it) off a profile. */
function clearStaleLock(profile: string): void {
  let target: string;
  try {
    target = fs.readlinkSync(path.join(profile, "SingletonLock"));
  } catch {
    return;
  }
  try {
    process.kill(Number(target.split("-").pop()), 0);
  } catch {
    for (const name of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) fs.rmSync(path.join(profile, name), { force: true });
  }
}

function prepareProfile(profile: string): void {
  fs.mkdirSync(path.join(profile, "Default"), { recursive: true, mode: 0o700 });
  const preferences = path.join(profile, "Default", "Preferences");
  if (!fs.existsSync(preferences)) fs.writeFileSync(preferences, JSON.stringify(PREFERENCES));
  clearStaleLock(profile);
}

/** Forgets a thread's tab, however it closed: its page then says the tab closed. */
function dropTab(workspace: string, entry: Entry, key: string): void {
  entry.tabs.delete(key);
  entry.notes.delete(key);
  entry.needs.delete(key);
  entry.offers.delete(key);
  entry.holds.delete(key);
  entry.screens.delete(key);
  forgetTab(workspace, key);
}

/** Forgets a workspace's browser and every tab in it. */
function dropEntry(workspace: string, entry: Entry): void {
  const { browsers } = state();
  if (browsers.get(workspace) !== entry) return;
  browsers.delete(workspace);
  clearTimeout(entry.timer ?? undefined);
  for (const key of [...entry.tabs.keys()]) dropTab(workspace, entry, key);
}

async function closeEntry(workspace: string): Promise<void> {
  const entry = state().browsers.get(workspace);
  if (!entry) return;
  dropEntry(workspace, entry);
  await (await entry.ready.catch(() => null))?.close().catch(() => {});
}

/** Keeps a workspace's browser open IDLE_MS from now. */
function touch(workspace: string, entry: Entry): void {
  entry.last = Date.now();
  clearTimeout(entry.timer ?? undefined);
  entry.timer = setTimeout(() => void closeEntry(workspace), IDLE_MS);
  entry.timer.unref?.();
}

async function launch(workspace: string): Promise<Browser> {
  const profile = path.join(workspaceDir(workspace), "profile");
  prepareProfile(profile);
  const browser = await puppeteer().launch({ headless: "new", userDataDir: profile, args: ARGS, defaultViewport: VIEWPORT, handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false });
  browser.on("disconnected", () => {
    const entry = state().browsers.get(workspace);
    if (entry?.browser === browser) dropEntry(workspace, entry);
  });
  return browser;
}

/** The workspace's browser entry, its browser launched (and the least recently used one closed,
 *  past MAX_BROWSERS) if it isn't running. */
async function entryFor(workspace: string): Promise<Entry> {
  const { browsers } = state();
  let entry = browsers.get(workspace);
  if (!entry) {
    const others = [...browsers.entries()].sort((a, b) => a[1].last - b[1].last);
    while (others.length >= MAX_BROWSERS) await closeEntry(others.shift()![0]);
    const made: Entry = { tabs: new Map(), notes: new Map(), needs: new Map(), offers: new Map(), holds: new Map(), screens: new Map(), authenticators: new Map(), secrets: new Set(), fence: makeFence(), last: Date.now(), timer: null, ready: null!, touch: () => touch(workspace, made), busy: new Set() };
    made.ready = launch(workspace).then((browser) => (made.browser = browser));
    browsers.set(workspace, (entry = made));
    try {
      await entry.ready;
    } catch (e) {
      browsers.delete(workspace);
      throw new BrowserError(`Chrome didn't start: ${firstLine(e)}`);
    }
  }
  await entry.ready;
  touch(workspace, entry);
  return entry;
}

/** Every request `page` makes through the fence; with `key`, a refused navigation of its main frame
 *  is noted for that tab's next read. */
async function fenced(entry: Entry, page: Page, key?: string): Promise<void> {
  page.setDefaultTimeout(ACT_MS);
  page.setDefaultNavigationTimeout(NAVIGATE_MS);
  await page.setRequestInterception(true);
  page.on("request", async (request) => {
    if (request.isInterceptResolutionHandled?.()) return;
    const why = await entry.fence(request.url());
    try {
      if (!why) return await request.continue();
      if (key && request.isNavigationRequest() && request.frame() === page.mainFrame()) note(entry, key, `refused to open ${request.url().slice(0, 200)}: ${why}. ${FENCED}`);
      await request.abort("blockedbyclient");
    } catch {
      // the page went away meanwhile
    }
  });
}

/** Sets up a tab of `key`'s in `workspace`'s browser: the screen its page asked for, the fence on
 *  every request, a passkey authenticator, dialogs answered and noted, a popup it opens made the
 *  thread's tab until it closes. */
async function adopt(workspace: string, entry: Entry, key: string, page: Page): Promise<Page> {
  const screen = entry.screens.get(key);
  if (screen) await page.setViewport(screen).catch(() => {});
  await fenced(entry, page, key);
  await passkey.attach(entry, key, page, () => void redraw(workspace, entry, key).catch(() => {}));
  page.on("dialog", async (dialog) => {
    const accept = dialog.type() === "alert" || dialog.type() === "beforeunload";
    note(entry, key, `the page showed a ${dialog.type()} ("${dialog.message().slice(0, 200)}"), which was ${accept ? "accepted" : "dismissed"}`);
    await (accept ? dialog.accept() : dialog.dismiss()).catch(() => {});
  });
  page.on("popup", async (popup) => {
    if (!popup) return;
    const opener = entry.tabs.get(key);
    await adopt(workspace, entry, key, popup);
    entry.tabs.set(key, popup);
    note(entry, key, "the page opened a new window, which is this chat's tab until it closes");
    popup.once("close", () => {
      if (entry.tabs.get(key) === popup && opener && !opener.isClosed()) {
        entry.tabs.set(key, opener);
        note(entry, key, "the new window closed; the tab is the one before it again");
      }
    });
  });
  return page;
}

/** A page of the workspace's browser for research (search, look), apart from every chat's tab and
 *  never shown: a desktop's screen, the fence on its requests, its dialogs dismissed and any window
 *  it opens closed. The caller closes it. */
export async function scratch(workspace: string): Promise<{ entry: Entry; page: Page }> {
  const entry = await entryFor(workspace);
  const page = await entry.browser!.newPage();
  await page.setViewport(DESKTOP).catch(() => {});
  await fenced(entry, page);
  page.on("dialog", (dialog) => void dialog.dismiss().catch(() => {}));
  page.on("popup", (popup) => void popup?.close().catch(() => {}));
  return { entry, page };
}

/** This chat's tab in the workspace's browser, opened if it has none. */
export async function tab(workspace: string, thread?: string | number): Promise<Tab> {
  const entry = await entryFor(workspace);
  const key = threadKey(thread);
  let page = entry.tabs.get(key);
  if (!page || page.isClosed()) {
    page = await adopt(workspace, entry, key, await entry.browser!.newPage());
    entry.tabs.set(key, page);
  }
  return { workspace, entry, page, key };
}

/** This chat's open tab, or a BrowserError saying to open an address first. */
export function existing(workspace: string, thread?: string | number): Tab {
  const entry = state().browsers.get(workspace);
  const key = threadKey(thread);
  const page = entry?.tabs.get(key);
  if (!entry || !page || page.isClosed()) throw new BrowserError("this chat has no page open: open an address first");
  touch(workspace, entry);
  return { workspace, entry, page, key };
}

/** Loads `url` in `page` of `entry`'s browser, the fence asked first (a BrowserError when it
 *  refuses); answers why loading didn't finish, or null when it did. */
export async function load(entry: Entry, page: Page, url: string): Promise<string | null> {
  const refused = await entry.fence(url);
  if (refused) throw new BrowserError(`${url} isn't opened: ${refused}. The browser reaches the public web only, and the hosts the user lets through in FENCE_ALLOW. ${FENCED}`);
  let failed: string | null = null;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
  } catch (e) {
    failed = firstLine(e);
  }
  await settle(page, 0);
  return failed;
}
