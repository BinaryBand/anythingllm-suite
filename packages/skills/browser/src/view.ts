// The page as the agent reads it: its title and address, its interactive elements with their refs
// (snapshot.ts), then its visible text, then what happened since the last read. What the user gave
// through login never shows: each value is hidden wherever it appears (#shared/answer mask).

import { mask } from "#shared/answer";
import type { Snap } from "./snapshot";

const MAX_ELEMENTS = 150;
const MAX_TEXT = 6000;

const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

/** The lines of `text` that hold `find` (any case), each with the line before and after. */
function finding(text: string, find: string): string[] {
  const lines = text.split("\n");
  const needle = find.toLowerCase();
  const keep = new Set<number>();
  lines.forEach((line, i) => {
    if (line.toLowerCase().includes(needle)) for (const j of [i - 1, i, i + 1]) if (j >= 0 && j < lines.length) keep.add(j);
  });
  return [...keep].sort((a, b) => a - b).map((i) => lines[i]);
}

interface Rendered {
  title: string;
  url: string;
  snap: Snap;
  notes?: string[];
  find?: string;
  from?: unknown;
  secrets?: Iterable<string>;
  /** The action that reads it again: read, or look. */
  again?: string;
}

/** The text the agent reads for a page. `from` reads its text on from that character, without the
 *  elements. */
export function render({ title, url, snap, notes = [], find = "", from = 0, secrets = [], again = "read" }: Rendered): string {
  const out = [`Page: ${clip(title || "(no title)", 200)}`, `Address: ${url}`, ""];
  const all = snap.elements;
  const elements = all.slice(0, MAX_ELEMENTS);
  const moreElements = snap.more || all.length > MAX_ELEMENTS;
  const text = snap.text;
  const start = Math.max(0, Math.floor(Number(from) || 0));
  if (find) {
    const needle = find.toLowerCase();
    const matched = all.filter((e) => e.toLowerCase().includes(needle));
    const lines = finding(text, find);
    out.push(`Elements with "${find}" (${matched.length}):`, ...(matched.length ? matched : ["(none)"]), "");
    out.push(`Text with "${find}":`, ...(lines.length ? lines : ["(none)"]));
  } else if (start) {
    out.push(`Text from character ${start} of ${text.length} (${again} without from for the elements):`, text.slice(start, start + MAX_TEXT) || "(nothing past there)");
    if (start + MAX_TEXT < text.length) out.push(`… the page goes on: ${again} with from ${start + MAX_TEXT}`);
  } else {
    out.push(`Elements (${elements.length}${moreElements ? "+" : ""}):`, ...(elements.length ? elements : ["(none)"]));
    if (moreElements) out.push(`… more than ${MAX_ELEMENTS}: ${again} with find to look for one`);
    out.push("", "Text:", text.slice(0, MAX_TEXT) || "(none)");
    if (text.length > MAX_TEXT) out.push(`… the page goes on: ${again} with from ${MAX_TEXT}, or with find${again === "read" ? ", or scroll_down and read again" : ""}`);
  }
  if (notes.length) out.push("", "Since the last read:", ...notes.map((n) => `- ${n}`));
  return mask(out.join("\n"), [...secrets]);
}
