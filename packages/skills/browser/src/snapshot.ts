// The page as the agent reads it (view.ts): its visible interactive elements, each tagged with a ref
// (data-bw-ref) that act targets, then its visible text. A ref stays with its element for the life
// of the page, so refs from an earlier read still work while the element is there. Open shadow
// roots are walked; frames aren't. It also gives where each field one types into sits in view, for
// the tab's page to put an input over while the user holds the tab. `snapshot` runs in the page
// (page.evaluate), so it uses nothing outside itself.

import type { Page } from "./host";
import { firstLine } from "./state";

/** A field in view one types into: its ref, its box in the page's CSS pixels, its input type. */
export interface Field {
  ref: string;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: string;
  filled: boolean;
}

export interface Snap {
  elements: string[];
  text: string;
  more: boolean;
  fields: Field[];
}

function snapshot({ snapshot: maxElements }: { snapshot: number }): Snap {
  const { document, window, getComputedStyle, innerWidth, innerHeight } = globalThis as any;
  const INTERACTIVE = new Set(["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "SUMMARY"]);
  const ROLES = new Set(["button", "link", "checkbox", "radio", "switch", "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "combobox", "textbox", "searchbox", "slider", "spinbutton"]);
  const clip = (s: string, n: number) => {
    s = (s || "").replace(/\s+/g, " ").trim();
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  };
  const visible = (el: any) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const st = getComputedStyle(el);
    return st.visibility !== "hidden" && st.display !== "none" && st.opacity !== "0";
  };
  const interactive = (el: any) => {
    if (INTERACTIVE.has(el.tagName)) {
      if (el.tagName === "A") return el.hasAttribute("href");
      if (el.tagName === "INPUT") return el.type !== "hidden";
      return true;
    }
    const role = el.getAttribute("role");
    return (role && ROLES.has(role)) || (el.isContentEditable && el.parentElement?.isContentEditable !== true);
  };
  const name = (el: any) =>
    clip(
      el.getAttribute("aria-label") ||
        el.labels?.[0]?.innerText ||
        el.getAttribute("title") ||
        el.getAttribute("alt") ||
        (["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName) ? "" : el.innerText) ||
        el.getAttribute("placeholder") ||
        el.getAttribute("name") ||
        "",
      80,
    );
  const describe = (el: any) => {
    const tag = el.tagName.toLowerCase();
    let kind = el.getAttribute("role") || (tag === "a" ? "link" : tag === "summary" ? "button" : tag);
    if (tag === "input") kind = `input[${el.type}]`;
    let line = `${kind} "${name(el)}"`;
    if (tag === "a") {
      const href = el.getAttribute("href") || "";
      if (href && !href.startsWith("javascript:")) line += ` -> ${clip(href, 100)}`;
    }
    if (tag === "input" && (el.type === "checkbox" || el.type === "radio")) line += el.checked ? " (checked)" : " (unchecked)";
    else if (tag === "input" && el.type === "password") {
      if (el.value) line += " (filled)";
    } else if (tag === "input" || tag === "textarea") {
      if (el.value) line += ` value="${clip(el.value, 80)}"`;
      else if (el.placeholder) line += ` placeholder="${clip(el.placeholder, 60)}"`;
    } else if (tag === "select") {
      const options = [...el.options].slice(0, 12).map((o: any) => (o.selected ? `*${clip(o.text, 40)}` : clip(o.text, 40)));
      line += ` options: ${options.join(" | ")}${el.options.length > 12 ? " | …" : ""}`;
    }
    if (el.disabled || el.getAttribute("aria-disabled") === "true") line += " (disabled)";
    return line;
  };
  const MAX_FIELDS = 60;
  const NOT_TYPED = new Set(["checkbox","radio", "hidden", "button", "submit", "reset", "image", "file", "range", "color"]);
  const field = (el: any, ref: string): Field | null => {
    const typed = (el.tagName === "INPUT" && !NOT_TYPED.has(el.type)) || el.tagName === "TEXTAREA" || (el.isContentEditable && el.parentElement?.isContentEditable !== true);
    if (!typed || el.disabled || el.readOnly) return null;
    const r = el.getBoundingClientRect();
    if (r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth) return null;
    const kind = el.tagName === "INPUT" ? el.type || "text" : el.tagName === "TEXTAREA" ? "textarea" : "text";
    return { ref, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), kind, filled: !!("value" in el ? el.value : el.textContent) };
  };
  let next: number = window.__bwNext || 1;
  const lines: string[] = [];
  const fields: Field[] = [];
  const walk = (root: any) => {
    for (const el of root.querySelectorAll("*")) {
      if (el.shadowRoot) walk(el.shadowRoot);
      if (lines.length >= maxElements) return;
      if (!interactive(el) || !visible(el)) continue;
      let ref = el.getAttribute("data-bw-ref");
      if (!ref) {
        ref = `e${next++}`;
        el.setAttribute("data-bw-ref", ref);
      }
      lines.push(`[${ref}] ${describe(el)}`);
      const f = field(el, ref);
      if (f && fields.length < MAX_FIELDS) fields.push(f);
    }
  };
  walk(document);
  window.__bwNext = next;
  const text = String(document.body ? document.body.innerText : "")
    .split("\n")
    .map((l: string) => l.replace(/\s+/g, " ").trim())
    .filter((l: string, i: number, all: string[]) => l || (i > 0 && all[i - 1]))
    .join("\n")
    .trim();
  return { elements: lines, text, more: lines.length >= maxElements, fields };
}

/** What snapshot lists at most; view.ts shows fewer and says there are more. */
const SNAPSHOT_ELEMENTS = 400;

/** The page now: { snap, title, url }, with a snap saying why when it can't be read. */
/** Whether a line of a read is a password field. */
export const isPasswordLine = (line: string): boolean => line.includes("input[password]");

/** Whether the page as read asks for a password. */
export const asksPassword = (snap: Snap): boolean => snap.elements.some(isPasswordLine);

export async function readPage(page: Page): Promise<{ snap: Snap; title: string; url: string }> {
  const [snap, title] = await Promise.all([
    page.evaluate(snapshot, { snapshot: SNAPSHOT_ELEMENTS }).catch((e): Snap => ({ elements: [], text: `(couldn't read the page: ${firstLine(e)})`, more: false, fields: [] })),
    page.title().catch(() => ""),
  ]);
  return { snap, title, url: page.url() };
}
