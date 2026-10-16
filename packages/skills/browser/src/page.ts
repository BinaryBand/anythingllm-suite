// A tab's card and its page. After each step the tab's picture is taken and written into
// AnythingLLM's public folder (public/browser-lean/, served to any browser), with a small state file
// beside it (its title and address, what the agent asks the user for, the saved logins without
// their passwords) and the tab's page (static/pages/tab.html), all under a random name kept for the
// chat's tab. The card the agent puts in its reply is a crop of the picture that opens the page.
//
// The page is where the user gives what only they may know: a login or a code the agent asked for,
// sealed on their device with the vault's public key, posted through AnythingLLM's browser-extension
// upload (#shared/pages), checked against the tab's secret and typed into the tab here; never on
// AnythingLLM's question card, which shows its answers in the chat. It also deletes a saved login.
// Events are applied as they come while a page was shown lately, and at the start of each call.

import fs from "node:fs";
import path from "node:path";
import { writeAtomic } from "#shared/atomic";
import { Told } from "#shared/errors";
import { hostOf, onSite } from "#shared/fence";
import { newSecret, pageHtml, publicDir, removePublic, sameSecret, takeEvents, watch, writePublic } from "#shared/pages";
import * as vault from "#shared/vault";
import { typeIn } from "./act";
import * as logins from "./logins";
import { type Entry, type Need, type Tab, VIEWPORT, note, skillDir, state, statics, workspaceDir } from "./state";

const TITLE = "browser-lean-event";
/** How long the pages' events are watched for after one was last shown. */
const WATCH_MS = 30 * 60 * 1000;
/** How long the agent's request for a login or a code waits on the page. */
export const NEED_MS = 10 * 60 * 1000;
const QUALITY = 70;
/** A tab's files: its picture, the card's crop, its state and its page. */
const ENDINGS = [".jpg", "-card.jpg", ".json", ".html"];
const MAX_TEXT = 500;

type Names = { token: string; secret: string };

const tabsFile = (workspace: string) => path.join(workspaceDir(workspace), "tabs.json");
/** A tab's file in the public folder, by one of ENDINGS. */
const pub = (token: string, ending: string) => `browser-lean/${token}${ending}`;

function readTabs(workspace: string): Record<string, Names> {
  try {
    return JSON.parse(fs.readFileSync(tabsFile(workspace), "utf8"));
  } catch {
    return {};
  }
}

const saveTabs = (workspace: string, tabs: Record<string, Names>) => writeAtomic(tabsFile(workspace), JSON.stringify(tabs, null, 2), 0o600);

/** A thread's tab's names, kept in tabs.json: its token names its files; its secret goes with every
 *  event its page posts. Made the first time unless `make` is false (then null). */
function namesOf(workspace: string, key: string, make = true): Names | null {
  const tabs = readTabs(workspace);
  if (tabs[key]?.token && tabs[key]?.secret) return tabs[key];
  if (!make) return null;
  tabs[key] = { token: newSecret(), secret: newSecret(24) };
  saveTabs(workspace, tabs);
  return tabs[key];
}

/** When a thread's tab closes: its files go, its state says so, for its page to show, and its names
 *  are dropped, so a link to it opens nothing again and the next tab gets new ones. */
export function forgetTab(workspace: string, key: string): void {
  const tabs = readTabs(workspace);
  const token = tabs[key]?.token;
  if (!token) return;
  delete tabs[key];
  try {
    saveTabs(workspace, tabs);
    for (const ending of ENDINGS) removePublic(pub(token, ending));
    writePublic(pub(token, ".json"), JSON.stringify({ closed: true }));
  } catch {
    // no folder to write in
  }
}

/** What the agent waits for the user to enter on the tab's page, or null: one that ran out goes. */
function pendingNeed(entry: Entry, key: string): Need | null {
  const need = entry.needs.get(key);
  if (need && need.until <= Date.now()) entry.needs.delete(key);
  return entry.needs.get(key) ?? null;
}

/** Text a card's Markdown can hold: no brackets or line breaks. */
const plain = (text: string, n = 120) => text.replace(/[[\]()\n\r|*_`<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

/** The tab's state, as its page reads it: nothing secret. */
function tabState(at: Tab, title: string, url: string) {
  const host = hostOf(url);
  const need = pendingNeed(at.entry, at.key);
  const screen = at.page.viewport() ?? VIEWPORT;
  return {
    title: title.slice(0, 200),
    url: url.slice(0, 2000),
    host,
    shot: Date.now(),
    size: { w: screen.width, h: screen.height },
    need: need ? { kind: need.kind, host: need.host, text: need.text, label: need.label ?? null, hasUser: !!need.userRef, until: need.until } : null,
    logins: logins.list().map((l) => ({ ...l, here: onSite(host, l.site) })),
  };
}

/** Takes the tab's picture (and with `card`, the card's crop) and writes its state and its page;
 *  answers the page's token, or null where AnythingLLM's public folder can't be written (AnythingLLM
 *  Desktop) or no page key can be made. */
async function draw(at: Tab, card: boolean): Promise<string | null> {
  const names = namesOf(at.workspace, at.key)!;
  const title = await at.page.title().catch(() => "");
  try {
    const shot = path.join(publicDir(), pub(names.token, ""));
    fs.mkdirSync(path.dirname(shot), { recursive: true });
    await at.page.screenshot({ path: `${shot}.jpg`, type: "jpeg", quality: QUALITY });
    if (card) {
      const { width, height } = at.page.viewport() ?? VIEWPORT;
      await at.page.screenshot({ path: `${shot}-card.jpg`, type: "jpeg", quality: QUALITY, clip: { x: 0, y: 0, width, height: Math.min(height, Math.round(width * 1.2)), scale: 0.5 } });
    }
    writePublic(pub(names.token, ".json"), JSON.stringify(tabState(at, title, at.page.url())));
    writePublic(pub(names.token, ".html"), await pageHtml(statics().get("pages/tab.html")!.text, skillDir(), { token: names.token, secret: names.secret, title: TITLE, workspace: at.workspace, tab: at.key }));
  } catch {
    return null;
  }
  const until = Date.now() + WATCH_MS;
  watch(TITLE, drain, () => until);
  return names.token;
}

/** Draws the tab `at` for the agent's answer: its card's Markdown lines (a crop of its picture that
 *  opens its page, then its title and address; those alone where there's no picture) and whether it
 *  has a page the user can answer on. `base` is the address the user's browser reaches AnythingLLM
 *  at (null: links from its own root). */
export async function card(at: Tab, base: string | null): Promise<{ lines: string[]; page: boolean }> {
  const [token, title] = await Promise.all([draw(at, true), at.page.title().catch(() => "")]);
  const url = at.page.url();
  const host = hostOf(url);
  const name = plain(title) || plain(host || url);
  const lines = [`**${name}** · ${plain(host || url, 200)}`];
  if (!token) return { lines, page: false };
  const link = `${base ?? ""}/browser-lean/${token}`;
  return { lines: [`[![${name}](${link}-card.jpg?v=${Date.now().toString(36)})](${link}.html)`, "", ...lines], page: true };
}

/** Saves the login the user offered on the tab's page once its page no longer asks for a password
 *  (`asksPassword`, from the agent's read): the login took. Dropped when the tab left its site. */
export async function keepOffer(at: Tab, asksPassword: boolean): Promise<void> {
  const offer = at.entry.offers.get(at.key);
  if (!offer) return;
  if (offer.until <= Date.now() || !onSite(hostOf(at.page.url()), offer.site)) return void at.entry.offers.delete(at.key);
  if (asksPassword) return;
  at.entry.offers.delete(at.key);
  await logins.save(offer.site, offer.user, offer.pass);
  note(at.entry, at.key, `the login the user entered was saved for ${offer.site}, for next time`);
}

const text = (v: unknown, n = MAX_TEXT) => String(v ?? "").slice(0, n);

/** Applies one event the page of `at` posted; answers whether the tab changed. */
async function apply(e: Record<string, unknown>, at: Tab | null): Promise<boolean> {
  if (e.ev === "login-delete") return void (await logins.remove(text(e.id, 100))), false;
  if (!at) return false; // the tab closed meanwhile
  const need = pendingNeed(at.entry, at.key);
  if (e.ev === "need-cancel") {
    if (need) note(at.entry, at.key, "the user chose not to enter it now, so nothing was typed; tell them you can't go on without it");
    at.entry.needs.delete(at.key);
    return !!need;
  }
  if (e.ev !== "need-answer" || !need) return false;
  const login = need.kind === "login";
  const secret = login ? vault.openSealed(text(e.sealed, 20000)) : text(e.text).trim();
  const user = login ? text(e.user).trim() : "";
  if (!secret || (need.userRef && !user)) return false;
  at.entry.needs.delete(at.key);
  await typeIn(at, need.host, { userRef: need.userRef, user, secretRef: need.secretRef, secret }, need.submitRef);
  if (login && need.userRef && e.save === true) at.entry.offers.set(at.key, { site: need.host, user, pass: secret, until: Date.now() + NEED_MS });
  note(at.entry, at.key, `the user entered ${login ? "the login" : "the code"} you asked for on the tab's page and it was typed into the page${need.submitRef ? ` and ${need.submitRef} clicked` : ", but nothing was submitted: submit it with act (press Enter in the field, or click the button)"}; it stays hidden from you. Read the page to see whether it worked`);
  return true;
}

/** Applies every event the tabs' pages posted since the last time, in order, each only with its
 *  tab's secret; then draws each tab that changed. One that fails is skipped, and its tab says so. */
export async function drain(): Promise<void> {
  const changed = new Set<Tab>();
  for (const e of takeEvents(TITLE, "browser_lean_event")) {
    const workspace = text(e.workspace, 100);
    const key = text(e.tab, 100);
    let names: Names | null;
    try {
      names = namesOf(workspace, key, false);
    } catch {
      continue; // no such workspace
    }
    if (!names || !sameSecret(e.secret, names.secret)) continue; // not this tab's: an old link's, or a forgery
    const entry = state().browsers.get(workspace);
    const page = entry?.tabs.get(key);
    const at = entry && page && !page.isClosed() ? ([...changed].find((t) => t.page === page) ?? { workspace, entry, page, key }) : null;
    try {
      if ((await apply(e, at)) && at) changed.add(at);
    } catch (err) {
      if (!(err instanceof Told)) throw err;
      if (at) (note(at.entry, at.key, `what the user entered on the tab's page couldn't be used: ${err.message}`), changed.add(at));
    }
  }
  for (const at of changed) await draw(at, false);
}
