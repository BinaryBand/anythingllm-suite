// Tasks on the web for the agent: it researches (search, look: research.ts) or clicks through a
// site in a real Chrome, run by this skill inside AnythingLLM with a tab per chat (browser.ts). In
// the tab the agent opens an address, reads the page as text with a ref on each element, and acts by
// those refs; call sends a request from the tab, with its signed-in session, for a site's own JSON.
// Each answer about the tab ends with its card, which opens the tab's page (page.ts), where the user
// can also take the tab over (takeover.ts): the agent then reads but doesn't act until it's handed
// back. A login comes from the saved logins (logins.ts, in the instance's vault) or from the user on
// the tab's page, straight to this skill, which types it into the page: the model never sees it. A
// saved passkey signs in by itself (passkey.ts). An API with a key is the library skill's.
//
// esbuild bundles this into the one handler.js AnythingLLM loads.

import { BINARY, answerText, bodyOf, headersOf, keepOf, methodOf, withParams } from "#shared/answer";
import { workspaceOf } from "#shared/anythingllm";
import { Told } from "#shared/errors";
import { FENCED, checkUrl, hostOf, onSite } from "#shared/fence";
import { entryOf } from "#shared/static";
import { act, checkAct, element, isPassword, settle, settled, typeIn } from "./act";
import { existing, load, tab } from "./browser";
import { BrowserError } from "./errors";
import type { HandlerContext } from "./host";
import * as logins from "./logins";
import { NEED_MS, card, caughtUp } from "./page";
import * as research from "./research";
import { type Scope, scopeOf } from "./scope";
import { readPage } from "./snapshot";
import { type Need, type Tab, firstLine, holder, note, state, statics, takeNotes, threadKey } from "./state";
import { free } from "./takeover";
import { render } from "./view";

type Args = Record<string, unknown>;

const clean = (v: unknown): string => String(v ?? "").trim();
/** A field's ref the agent gave, or undefined. */
const refOf = (v: unknown): string | undefined => clean(v) || undefined;
/** At most this many steps in one act. */
const MAX_ACT_STEPS = 20;
/** What a login asks the user for, by what: the wording is fixed here, never the model's, so a page
 *  can't steer the agent into asking the user for something else. */
const CODES: Record<string, string> = {
  code: "The verification code",
  authenticator: "The code from your authenticator app",
  sms: "The code sent to your phone",
  email: "The code sent to your email",
};

/** AnythingLLM's address, as the user set it for the skill (ANYTHINGLLM_URL); null when unset, and
 *  then the card's links are relative, which only AnythingLLM's own chat opens. */
const baseOf = (self: HandlerContext): string | null => clean(self.runtimeArgs?.ANYTHINGLLM_URL).replace(/\/+$/, "") || null;

/** The page as the agent reads it, then its card; `page` false when the tab has no page the user
 *  could answer on. */
async function reply(self: HandlerContext, at: Tab, lead: string, find = "", from: unknown = 0): Promise<{ text: string; page: boolean }> {
  const { snap, title, url } = await readPage(at.page);
  const drawn = await card(at, baseOf(self), { snap, title });
  const held = holder(at.entry, at.key) ? "The user has taken this tab over on its page: read it, but don't act in it until they hand it back.\n" : "";
  const read = render({ title, url, snap, notes: takeNotes(at.entry, at.key), find, from, secrets: at.entry.secrets });
  const put = "Put the card below in your reply exactly as given, with no label or heading: tapping it opens the tab's page, where the user watches it, gives what you ask them for, or takes it over.";
  return { text: [held + lead, "", read, "", put, ...drawn.lines].join("\n"), page: drawn.page };
}

const answer = async (self: HandlerContext, at: Tab, lead: string, find = "", from: unknown = 0) => (await reply(self, at, lead, find, from)).text;

/** The steps of an act: `steps` ([{ do, ref, text }], or that as JSON), else the one step given by
 *  do, ref and text; each checked before any is done. */
function actSteps(args: Args): { do: string; ref: string; text: string }[] {
  let steps: unknown = args.steps;
  if (steps === undefined || steps === null || steps === "") steps = [{ do: args.do, ref: args.ref, text: args.text }];
  if (typeof steps === "string") {
    try {
      steps = JSON.parse(steps);
    } catch {
      throw new BrowserError('steps is a list, as [{ "do": "click", "ref": "e4" }]');
    }
  }
  if (!Array.isArray(steps) || !steps.length || steps.length > MAX_ACT_STEPS) throw new BrowserError(`steps is a list of 1 to ${MAX_ACT_STEPS}, as [{ "do": "click", "ref": "e4" }]`);
  return steps.map((s: Args) => {
    const step = { do: clean(s?.do), ref: clean(s?.ref), text: s?.text === undefined || s?.text === null ? "" : String(s.text) };
    checkAct(step.do, step.ref, step.text);
    return step;
  });
}

const stepName = (s: { do: string; ref: string }) => `${s.do}${s.ref ? ` ${s.ref}` : ""}`;

/** Does the steps of an act in order, stopping at the first that fails. */
async function actAll(self: HandlerContext, scope: Scope, args: Args): Promise<string> {
  const steps = actSteps(args);
  const at = existing(scope.workspace, scope.thread);
  for (const [done, step] of steps.entries()) {
    try {
      await act(at.page, step.do, step.ref, step.text);
      await settled(at.page, step.do);
    } catch (e) {
      const why = e instanceof BrowserError ? e.message : `${step.do} failed: ${firstLine(e)}`;
      if (steps.length === 1) throw new BrowserError(why);
      await settle(at.page);
      return answer(self, at, `Did ${done} of ${steps.length} steps (${steps.slice(0, done).map(stepName).join(", ") || "none"}); step ${done + 1}, ${stepName(step)}, failed: ${why}. Nothing after it was done; read the page below before going on.`);
    }
  }
  return answer(self, at, `Did ${steps.length === 1 ? "" : `all ${steps.length} steps: `}${steps.map(stepName).join(", ")}.`);
}

/** The page's host, checked against `site` when the agent gave one. */
function hostChecked(at: Tab, site: unknown): string {
  const host = hostOf(at.page.url());
  if (!host) throw new BrowserError("the page has no site to sign in to");
  if (clean(site) && !onSite(host, site)) throw new BrowserError(`the page is on ${host}, not ${clean(site)}; nothing was asked`);
  return host;
}

/** Asks the user on the tab's page for what only they may know; the agent's turn doesn't wait: it
 *  ends with the tab's card, the user enters it there, and the skill types it into the page (page.ts). */
async function askOnPage(self: HandlerContext, at: Tab, need: Omit<Need, "until">): Promise<string> {
  at.entry.needs.set(at.key, { ...need, until: Date.now() + NEED_MS });
  const asked = await reply(self, at, `The user is asked on the tab's page: ${need.text}. Tell them to tap the card below and enter it there: it goes into the page without you seeing it. Never ask for it in the chat. When they say they're done, read the page; it says whether it was typed.`);
  if (asked.page) return asked.text;
  at.entry.needs.delete(at.key);
  throw new BrowserError(`${need.text}, and this AnythingLLM can't show the tab's page, where the user would enter it (its public folder can't be written, or no page key can be made)`);
}

/** Asks the user for a code (`what`) to go into the field `ref`. */
async function askCode(self: HandlerContext, at: Tab, args: Args): Promise<string> {
  const label = CODES[clean(args.what).toLowerCase()];
  if (!label) throw new BrowserError(`login asks for a code with what: ${Object.keys(CODES).join(", ")}`);
  const ref = refOf(args.ref);
  if (!ref) throw new BrowserError("login with what needs ref, the field the code goes into");
  await element(at.page, ref);
  const host = hostChecked(at, args.site);
  return askOnPage(self, at, { kind: "code", host, label, secretRef: ref, submitRef: refOf(args.submit_ref), text: `${label} for ${host}` });
}

/** Signs in: the login saved for the site typed in, or the user asked for one on the tab's page. */
async function signIn(self: HandlerContext, at: Tab, args: Args): Promise<string> {
  const [userRef, passRef, submitRef] = [refOf(args.user_ref), refOf(args.pass_ref), refOf(args.submit_ref)];
  const here = hostOf(at.page.url());
  if (here && !logins.forHost(here) && logins.forHost(here, "passkey")) throw new BrowserError(`no password is saved for ${here}, but a passkey is: click the site's passkey sign-in with act (a "Sign in with a passkey" button, say) and it signs in by itself`);
  if (!passRef) throw new BrowserError("login needs pass_ref, the password field's ref (and user_ref, the username's); or what and ref, for a code");
  if (!(await isPassword(await element(at.page, passRef)))) throw new BrowserError(`${passRef} isn't a password field`);
  if (userRef) await element(at.page, userRef);
  const host = hostChecked(at, args.site);
  const saved = logins.forHost(host);
  if (!saved) return askOnPage(self, at, { kind: "login", host, userRef, secretRef: passRef, submitRef, text: `${host} needs the user to sign in, and no login is saved for it` });
  self.super?.introspect?.(`Signing in to ${host} with the saved login`);
  await typeIn(at, host, { userRef, user: saved.user, secretRef: passRef, secret: saved.pass }, submitRef);
  const submitted = submitRef ? `and clicked ${submitRef}` : "; submit it with act (press Enter in the field, or click the sign-in button)";
  return answer(self, at, `Typed the login the user saved for ${saved.site} into the page ${submitted}. It's hidden from you; read the page below to see whether it worked.`);
}

/** A request from inside the tab, on its site's own origin, so the browser's signed-in session goes
 *  with it: for a site's own JSON, as its pages fetch it. */
async function call(scope: Scope, args: Args): Promise<string> {
  if (clean(args.auth) !== "session") throw new BrowserError('the browser\'s call goes with the tab\'s signed-in session: give auth "session". A call to an API with a key is the library skill\'s');
  const method = methodOf(args.method);
  const url = withParams(new URL(checkUrl(args.url)), args.params).href;
  const headers = headersOf(args.headers);
  const body = bodyOf(method, args.body, headers);
  const keep = keepOf(args.keep);
  const at = existing(scope.workspace, scope.thread);
  const refused = await at.entry.fence(url);
  if (refused) throw new BrowserError(`${url} isn't reached: ${refused}. ${FENCED}`);
  const origin = new URL(url).origin;
  if (!at.page.url().startsWith(origin + "/")) await load(at.entry, at.page, origin + "/");
  const got = await at.page.evaluate(
    async ({ url, method, headers, body, max }: { url: string; method: string; headers: Record<string, string>; body?: string; max: number }) => {
      const r = await fetch(url, { method, credentials: "include", headers, body });
      const shown: Record<string, string> = {};
      r.headers.forEach((v: string, k: string) => (shown[k] = v));
      const text = await r.text();
      return { status: r.status, headers: shown, text: text.slice(0, max), cut: text.length > max };
    },
    { url, method, headers, body, max: 2 * 1024 * 1024 },
  );
  const binary = BINARY.test(String(got.headers["content-type"] ?? ""));
  return answerText({ ...got, text: binary ? "" : got.text, bytes: got.text.length, binary }, `${method} ${url} (with the tab's session)`, keep, [...at.entry.secrets]);
}

/** The actions that change the tab: refused while the user holds it, and the user can't take it over
 *  while one runs. */
const ON_TAB = new Set(["open", "act", "login", "call"]);

/** Runs an action that changes the thread's tab, unless the user holds it (takeover.ts). */
async function onTab(scope: Scope, run: () => Promise<string> | string): Promise<string> {
  const entry = state().browsers.get(scope.workspace);
  const key = threadKey(scope.thread);
  if (entry) free(entry, key);
  entry?.busy.add(key);
  try {
    return await run();
  } finally {
    entry?.busy.delete(key);
  }
}

const ACTIONS: Record<string, (self: HandlerContext, scope: Scope, args: Args) => Promise<string> | string> = {
  guide: (self, scope, args) => entryOf(statics(), "guide", ".md", "topic", args.topic, "index").text,
  search: (self, scope, args) => {
    self.super?.introspect?.(`Searching for ${clean(args.query).slice(0, 100)}`);
    return research.search(scope.workspace, args.query, self.runtimeArgs?.SEARCH_URL);
  },
  look: (self, scope, args) => {
    if (!clean(args.url)) throw new BrowserError("look needs url, the address to read");
    return research.look(scope.workspace, args.url, { find: clean(args.find), from: args.from });
  },
  open: async (self, scope, args) => {
    const url = checkUrl(args.url);
    self.super?.introspect?.(`Opening ${url}`);
    const at = await tab(scope.workspace, scope.thread);
    const failed = await load(at.entry, at.page, url);
    if (failed) note(at.entry, at.key, `loading ${url} didn't finish: ${failed}`);
    return answer(self, at, `Opened ${url} in this chat's tab.`);
  },
  read: (self, scope, args) => answer(self, existing(scope.workspace, scope.thread), "This chat's tab as it is now.", clean(args.find), args.from),
  act: actAll,
  login: (self, scope, args) => {
    const at = existing(scope.workspace, scope.thread);
    return clean(args.what) ? askCode(self, at, args) : signIn(self, at, args);
  },
  call: (self, scope, args) => call(scope, args),
};

export const runtime = {
  handler: async function (this: HandlerContext, args: Args = {}): Promise<string> {
    const action = clean(args.action).toLowerCase() || "read";
    const fn = ACTIONS[action];
    if (!fn) return `The browser's action is ${Object.keys(ACTIONS).join(", ")}, not "${clean(args.action)}".`;
    try {
      if (workspaceOf(this)) {
        // What the user did on a tab's page since the last call, and the lean browser's logins, once.
        await caughtUp().catch((e) => this.logger?.(`browser-lean couldn't apply the tab pages' events: ${firstLine(e)}`));
        await logins.importLean(this.logger).catch((e) => this.logger?.(`browser-lean couldn't import the lean logins: ${firstLine(e)}`));
      }
      const scope = scopeOf(this);
      return await (ON_TAB.has(action) ? onTab(scope, () => fn(this, scope, args)) : fn(this, scope, args));
    } catch (e) {
      if (e instanceof Told) return `Browser: ${e.message.replace(/\.$/, "")}.`;
      this.logger?.(`browser-lean ${action} failed: ${(e as Error)?.stack || e}`);
      return `Browser ${action} failed: ${firstLine(e)}. Tell the user what went wrong; don't retry on your own.`;
    }
  },
};
