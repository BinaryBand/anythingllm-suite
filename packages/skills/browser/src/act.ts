// What act does to a page, by an element's ref from the last read. A ref looks like e12; press
// sends one plain key and never a shortcut, so nothing reaches the clipboard; nothing is ever typed
// into a password field but what login types, which only the user gave.

import { hostOf } from "#shared/fence";
import { BrowserError } from "./errors";
import type { ElementHandle, Page } from "./host";
import type { Tab } from "./state";

const ACTIONS = ["click", "fill", "type", "press", "select", "check", "uncheck", "hover", "scroll_down", "scroll_up", "back", "forward", "reload", "wait"];
const NEEDS_REF = new Set(["click", "fill", "type", "select", "check", "uncheck", "hover"]);
const NEEDS_TEXT = new Set(["fill", "type", "press", "select"]);
const REF = /^e\d{1,6}$/;
const KEYS = new Set(["Enter", "Tab", "Escape", "Backspace", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", "Space"]);
const SHIFTED = new Set(["Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"]);
export const ACT_MS = 10 * 1000;
export const NAVIGATE_MS = 30 * 1000;
/** The steps that may load another page, after which a read waits a moment for it. */
const NAVIGATES = new Set(["click", "press", "back", "forward", "reload"]);
const SCROLL_PX = 600;
const MAX_WAIT_S = 10;
const SETTLE_MS = 3000;

/** Whether press sends `key`: one of KEYS, one printable character, or Shift+ one of SHIFTED. */
function keyAllowed(key: string): boolean {
  if (KEYS.has(key) || ([...key].length === 1 && /\P{C}/u.test(key))) return true;
  const [modifier, rest] = key.split("+");
  return modifier === "Shift" && SHIFTED.has(rest);
}

/** A BrowserError unless `action` gets what it needs. */
export function checkAct(action: string, ref: string, text: string): void {
  if (!ACTIONS.includes(action)) throw new BrowserError(`do is one of ${ACTIONS.join(", ")}`);
  if (NEEDS_REF.has(action) && !REF.test(ref)) throw new BrowserError(`${action} needs the ref of an element from the last read, like e12`);
  if (ref && !REF.test(ref)) throw new BrowserError(`"${ref.slice(0, 20)}" isn't a ref; they look like e12`);
  if (NEEDS_TEXT.has(action) && !text) throw new BrowserError(`${action} needs text`);
  if (action === "press" && !keyAllowed(text)) throw new BrowserError(`"${text.slice(0, 40)}" isn't a key press sends: one key (Enter, Tab, Escape, Backspace, an arrow, a character…) or Shift with Tab or an arrow; shortcuts with Control, Meta or Alt aren't sent`);
}

/** The element `ref` names on `page`, inside open shadow roots too (as snapshot walks them), or a
 *  BrowserError saying to read again. */
export async function element(page: Page, ref: string): Promise<ElementHandle> {
  const found = await page.$(`pierce/[data-bw-ref="${ref}"]`);
  if (!found) throw new BrowserError(`${ref} isn't on the page any more; read it again for current refs`);
  return found;
}

/** Whether `target` is a password field: one now, one a read saw as one (snapshot marks it, so
 *  "Show password" turning it into a text field doesn't change that), or one that says it takes a
 *  password. */
export const isPassword = (target: ElementHandle): Promise<boolean> =>
  target.evaluate((el) => el.type === "password" || el.getAttribute?.("data-bw-secret") === "1" || /^(current|new)-password$/.test(String(el.getAttribute?.("autocomplete") ?? "")));

/** What `target` is when it isn't a field one types into (a link, a button…), else null. */
export const notTyped = (target: ElementHandle): Promise<string | null> =>
  target.evaluate((el) => {
    const tag = String(el.tagName ?? "").toLowerCase();
    const NOT_TYPED = ["checkbox", "radio", "hidden", "button", "submit", "reset", "image", "file", "range", "color"];
    if ((tag === "input" && !NOT_TYPED.includes(el.type)) || tag === "textarea" || el.isContentEditable) return null;
    return tag === "input" ? `input[${el.type}]` : tag === "a" ? "link" : tag || "element";
  });

/** Replaces what's in a field with `text`, typed as a person would, so the page sees it. */
export async function fill(target: ElementHandle, text: string): Promise<void> {
  await target.click({ clickCount: 3 });
  await target.evaluate((el) => {
    if ("value" in el) el.value = "";
    else if (el.isContentEditable) el.textContent = "";
  });
  await target.type(text);
}

/** Lets a page a step started load for a moment, so the read or the picture after shows it;
 *  `pause` waits first for a navigation the step may have started. */
export async function settle(page: Page, pause = 400): Promise<void> {
  if (pause) await new Promise((resolve) => setTimeout(resolve, pause));
  await page.waitForFunction(() => (globalThis as any).document.readyState !== "loading", { timeout: SETTLE_MS }).catch(() => {});
}

/** settle after the step `action`: a pause only after a step that may load another page. */
export const settled = (page: Page, action: string): Promise<void> => settle(page, NAVIGATES.has(action) ? 400 : 0);

/** The fields of `submit`'s form that keep it from being sent (empty but required, say), each as
 *  `e7 "Type the digits shown"`; none when it has no form or the form may be sent. */
const unsent = (submit: ElementHandle): Promise<string[]> =>
  submit.evaluate((el) => {
    const form = el.form ?? el.closest?.("form");
    if (!form || form.checkValidity()) return [];
    return [...form.elements]
      .filter((f: any) => f.willValidate && !f.checkValidity())
      .map((f: any) => {
        const label = String(f.labels?.[0]?.innerText || f.getAttribute("aria-label") || f.getAttribute("placeholder") || f.name || "").replace(/\s+/g, " ").trim().slice(0, 60);
        return `${f.getAttribute("data-bw-ref") ?? "a field"}${label ? ` "${label}"` : ""}`;
      });
  });

/** Types a login or a code into the tab `at`: `secret` (the password or the code, hidden from every
 *  read after) into `secretRef`, and into `confirmRef` too (a new account's "Confirm password"), and a
 *  username first, if given; only while its page is still on `host`. Then clicks `submitRef`, unless
 *  the form still has fields keeping it from being sent (a CAPTCHA, say): answers those, unsent. */
export async function typeIn(at: Tab, host: string, { userRef, user, secretRef, confirmRef, secret }: { userRef?: string; user?: string; secretRef: string; confirmRef?: string; secret: string }, submitRef?: string): Promise<string[]> {
  const now = hostOf(at.page.url());
  if (now !== host) throw new BrowserError(`the page moved to ${now || "another page"} meanwhile; nothing was typed`);
  if (userRef && user) await fill(await element(at.page, userRef), user);
  at.entry.secrets.add(secret);
  await fill(await element(at.page, secretRef), secret);
  if (confirmRef) await fill(await element(at.page, confirmRef), secret);
  const submit = submitRef ? await element(at.page, submitRef) : null;
  const missing = submit ? await unsent(submit) : [];
  if (submit && !missing.length) await submit.click();
  await settle(at.page);
  return missing;
}

async function pressKey(page: Page, target: ElementHandle | null, key: string): Promise<void> {
  const [modifier, rest] = key.split("+");
  if (target) await target.focus();
  if (modifier === "Shift" && rest) {
    await page.keyboard.down("Shift");
    await page.keyboard.press(rest);
    await page.keyboard.up("Shift");
  } else await page.keyboard.press(key);
}

async function select(target: ElementHandle, text: string): Promise<void> {
  const value = await target.evaluate((el, wanted: string) => {
    const option = [...(el.options || [])].find((o: { text: string; value: string }) => o.text.trim() === wanted || o.value === wanted);
    return option ? option.value : null;
  }, text);
  if (value === null) throw new BrowserError(`no option "${text}" in that list`);
  await target.select(value);
}

/** Does `action` on `page`; `ref` and `text` as checkAct allows them. */
export async function act(page: Page, action: string, ref: string, text: string): Promise<unknown> {
  checkAct(action, ref, text);
  const target = ref ? await element(page, ref) : null;
  const typesInto = action === "fill" || action === "type" ? target : action === "press" ? (target ?? (await page.evaluateHandle(() => (globalThis as any).document.activeElement))) : null;
  if (typesInto && (await isPassword(typesInto))) {
    throw new BrowserError(`${ref || "the focused field"} is a password field, which act never types into, even with a password the page or the chat shows: use login, which types a saved login or what the user enters on the tab's page`);
  }
  const navigation = { waitUntil: "domcontentloaded", timeout: NAVIGATE_MS };
  switch (action) {
    case "click":
      return target!.click();
    case "fill":
      return fill(target!, text);
    case "type":
      return target!.type(text, { delay: 20 });
    case "press":
      return pressKey(page, target, text);
    case "select":
      return select(target!, text);
    case "check":
    case "uncheck": {
      const checked = await target!.evaluate((el) => el.checked ?? el.getAttribute("aria-checked") === "true");
      return checked !== (action === "check") ? target!.click() : undefined;
    }
    case "hover":
      return target!.hover();
    case "scroll_down":
    case "scroll_up":
      if (target) return target.evaluate((el) => el.scrollIntoView({ block: "center" }));
      return page.mouse.wheel({ deltaY: action === "scroll_down" ? SCROLL_PX : -SCROLL_PX });
    case "back":
      return page.goBack(navigation);
    case "forward":
      return page.goForward(navigation);
    case "reload":
      return page.reload(navigation);
    case "wait":
      return new Promise((resolve) => setTimeout(resolve, Math.min(MAX_WAIT_S, Math.max(0, Number(text) || 2)) * 1000));
    default:
      return undefined;
  }
}
