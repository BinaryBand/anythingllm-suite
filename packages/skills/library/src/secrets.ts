// The keys the library calls with: each an entry of kind "key" in the instance's vault (#shared/vault)
// with the site it may go to, a name (its label) and its value, which the model never reads. The
// user gives one on AnythingLLM's question card, whose answer comes to this skill, not the model. A
// key goes with a request only to its own site (or a site under it), only over https (or plain http
// to a host the user lets through), put where the API wants it (as a bearer token, by HTTP Basic,
// in a header or in the query), and at most PER_MINUTE times a minute from one process (a scheduled
// job's child process counts its own).

import { perProcess } from "#shared/anythingllm";
import { NOT_SET } from "#shared/answer";
import { allowedHosts, bareHost, onSite, siteOf } from "#shared/fence";
import type { Headers } from "#shared/net";
import * as vault from "#shared/vault";
import { LibraryError } from "./errors";
import type { HandlerContext } from "./host";

/** How a key goes with a request: as a bearer token, by HTTP Basic (the key the password, with a
 *  user name or none), as Authorization with another scheme, in a header, or in the query. */
const AS = /^(bearer|basic(:[^:\s]{1,100})?|authorization:[A-Za-z][\w-]{0,30}|header:[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}|query:[\w.-]{1,64})$/i;
const LABEL = /^[\w .@:-]{1,60}$/;
const PER_MINUTE = 60;
const ASK_TIMEOUT_MS = 5 * 60 * 1000;

export interface Key {
  site: string;
  label: string;
}

/** `as`, checked. */
export function asOf(as: unknown): string {
  const text = String(as ?? "bearer").trim();
  if (!AS.test(text)) throw new LibraryError('a key goes "bearer", "basic", "basic:<user>", "authorization:<scheme>", "header:<name>" or "query:<name>", as the API\'s docs say');
  if (/^header:/i.test(text) && NOT_SET.test(text.slice(7))) throw new LibraryError(`a key can't go in ${text.slice(7)}: send it as "authorization:<scheme>", or in a header of the API's own`);
  return text;
}

/** A key's name, checked. */
export function labelOf(label: unknown): string {
  const name = String(label ?? "").trim();
  if (!LABEL.test(name)) throw new LibraryError("a key's name is letters, digits, spaces and . _ - @ :, at most 60");
  return name;
}

/** A site or host as a person writes it ("https://API.example.com/v1"), as a host: a public name,
 *  or a host the user lets through; null when it's neither. */
export function publicSite(raw: unknown): string | null {
  const want = siteOf(raw);
  return want && (/^[a-z0-9.-]+\.[a-z0-9-]+$/.test(want) || allowedHosts().includes(want)) ? want : null;
}

/** The site a key goes to, checked. */
export function siteChecked(site: unknown): string {
  const want = publicSite(site);
  if (!want) throw new LibraryError('a key needs site, the site it is sent to, like "api.example.com"');
  return want;
}

/** Whether an entry is a key named `label` (any case), or any key. */
const named = (label?: string) => (e: Readonly<vault.Entry>) => e.kind === "key" && (label === undefined || e.user.toLowerCase() === label.toLowerCase());

/** The saved keys, without their values. */
export const keys = (): Key[] => vault.entries().filter(named()).map((e) => ({ site: e.site, label: e.user }));

/** The name of the key a request to `host` goes with when it names none: the one saved for the
 *  host's site, the closest site first; a LibraryError when there's none, or no one. */
export function labelForHost(host: string): string {
  const found = keys()
    .filter((k) => onSite(host, k.site))
    .sort((a, b) => b.site.length - a.site.length);
  if (!found.length) throw new LibraryError(`no key is saved for ${host}: ask the user for one with secret`);
  if (found.length > 1 && found[0].site === found[1].site) throw new LibraryError(`several keys are saved for ${found[0].site} (${found.filter((k) => k.site === found[0].site).map((k) => k.label).join(", ")}): name one with auth's key`);
  return found[0].label;
}

/** Saves a key under `label`, replacing the value of one of that name. */
export async function saveKey(site: string, label: string, value: string): Promise<void> {
  await vault.update((v) => {
    const same = v.entries.find(named(label));
    if (same) Object.assign(same, { site, user: label, value });
    else v.entries.push({ id: vault.newId(), kind: "key", site, user: label, value });
  });
}

/** Asks the user for a key on AnythingLLM's question card and saves it; the answer comes to this
 *  skill only, and the card is kept in the chat with the answer hidden. */
export async function askKey(self: HandlerContext, site: string, label: string): Promise<void> {
  const agent = self.super;
  if (typeof agent?.requestUserClarification !== "function") {
    throw new LibraryError(`this chat can't show a question card (only AnythingLLM's own chat window can), so the user can't give the key for ${site} here yet: ask them to give it from AnythingLLM's chat window`);
  }
  agent.introspect?.(`Asking the user for a key for ${site}`);
  const questions = [{ kind: "input", question: `An API key or token for ${site}`, inputType: "text", placeholder: `Kept in the vault and sent only to ${site}; the model never sees it` }];
  const result = await agent.requestUserClarification({ questions, allowSkip: true, timeoutMs: ASK_TIMEOUT_MS });
  agent.addClarifyingQuestionSurvey?.({ questions, result: { ...result, answers: (result.answers || []).map((a) => (a.answer ? { ...a, answer: "•••" } : a)) } });
  if (result.timedOut) throw new LibraryError("the user didn't answer the card in time; nothing was saved");
  const value = String(result.answers?.[0]?.answer ?? "").trim();
  if (result.skipped || !value) throw new LibraryError("the user gave no key; nothing was saved");
  await saveKey(site, label, value);
}

/** Whether a key for `site` may go to `url`: on its site, over https (or plain http to a host the
 *  user lets through). */
function mayGo(site: string, url: URL): boolean {
  return onSite(bareHost(url), site) && (url.protocol === "https:" || allowedHosts().includes(bareHost(url).toLowerCase()));
}

export interface Credentialed {
  url: string;
  headers: Headers;
  /** The key's value, to hide in whatever is said of the answer. */
  value: string;
  /** The headers a redirect may go on with: the key's, only to where it may go. */
  next: (to: string) => Headers | null;
}

/** A request with the key `label` put where `as` says, when it may go to `url`. */
export function credentialed(label: string, as: string, url: string, headers: Headers): Credentialed {
  const key = vault.entries().find(named(label));
  if (!key) throw new LibraryError(`no key named "${label}" is saved: ask the user for it with secret`);
  const target = new URL(url);
  if (!mayGo(key.site, target)) throw new LibraryError(`the key "${label}" is for ${key.site} over https, and goes nowhere else: not to ${target.origin}`);
  const now = Date.now();
  const recent = perProcess("library-lean.key-calls", () => new Map<string, number[]>());
  const times = (recent.get(key.id) || []).filter((t) => now - t < 60 * 1000);
  if (times.length >= PER_MINUTE) throw new LibraryError(`the key "${label}" was used ${PER_MINUTE} times in the last minute: wait a minute, and make fewer requests`);
  recent.set(key.id, [...times, now]);
  const value = String(key.value);
  const sent = { ...headers };
  const [kind, ...rest] = as.split(":");
  const arg = rest.join(":");
  switch (kind.toLowerCase()) {
    case "bearer":
      sent.Authorization = `Bearer ${value}`;
      break;
    case "basic":
      sent.Authorization = `Basic ${Buffer.from(`${arg}:${value}`).toString("base64")}`;
      break;
    case "authorization":
      sent.Authorization = `${arg} ${value}`;
      break;
    case "header":
      sent[arg] = value;
      break;
    case "query":
      target.searchParams.set(arg, value);
      break;
  }
  return { url: target.href, headers: sent, value, next: (to) => (mayGo(key.site, new URL(to)) ? sent : null) };
}
