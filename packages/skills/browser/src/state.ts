// What the skill's modules share: the state that must outlive a reload of handler.js (AnythingLLM
// loads it afresh for each agent run, so the browsers, their tabs and what the user typed are kept
// per process), where the skill keeps things in AnythingLLM's storage, and the screen a tab draws.

import path from "node:path";
import { perProcess, storageDir } from "#shared/anythingllm";
import type { makeFence } from "#shared/fence";
import { staticFiles, type StaticFiles } from "#shared/static";
import { BrowserError } from "./errors";
import type { Browser, Page } from "./host";

/** A tab's screen: a phone's, drawn sharp. */
export const VIEWPORT = { width: 430, height: 932, deviceScaleFactor: 2 };

/** What the agent asked the user to enter on the tab's page: a login or a code, typed into the
 *  fields by their refs once the user gives it there, while the page is still on `host`. */
export interface Need {
  kind: "login" | "code";
  host: string;
  text: string;
  label?: string;
  userRef?: string;
  secretRef: string;
  submitRef?: string;
  until: number;
}

/** A workspace's browser and its tabs, one per chat thread. */
export interface Entry {
  browser?: Browser;
  ready: Promise<Browser>;
  tabs: Map<string, Page>;
  /** What happened in a tab since its last read, for the agent. */
  notes: Map<string, string[]>;
  needs: Map<string, Need>;
  /** A login the user entered on a tab's page and asked to save: saved at the tab's next read once
   *  its page no longer asks for a password (it was taken), dropped when the tab leaves its site. */
  offers: Map<string, { site: string; user: string; pass: string; until: number }>;
  /** What was typed into its pages that only the user may know, hidden from every read. */
  secrets: Set<string>;
  fence: ReturnType<typeof makeFence>;
  last: number;
  timer: NodeJS.Timeout | null;
}

export const state = () =>
  perProcess("browser-lean.state", () => ({
    browsers: new Map<string, Entry>(),
    /** A thread-less run's tab, by its agent (scope.ts). */
    runs: new WeakMap<object, string>(),
    leases: new Map<string, Map<string, { run: WeakRef<object>; last: number }>>(),
    /** Whether the lean browser's logins were imported (logins.ts). */
    imported: false,
  }));

/** A tab's own name when the chat has no thread (the workspace's default chat). */
export const NO_THREAD = "_";
export const threadKey = (thread: string | number | undefined): string => (thread === undefined ? NO_THREAD : String(thread));

/** The skill's folder in AnythingLLM's storage. */
export const skillDir = (): string => path.join(storageDir(), "browser-lean");

/** The skill's static files (guide, pages), as shipped or as tuned on this instance, under
 *  <storage>/browser-lean/static/. */
export const statics = (): StaticFiles => staticFiles(STATIC_FILES, path.join(skillDir(), "static"));

/** The skill's folder for a workspace in AnythingLLM's storage. */
export function workspaceDir(workspace: string): string {
  if (!/^[\w-]{1,100}$/.test(workspace) || workspace === "static") throw new BrowserError(`"${workspace}" isn't a workspace name the browser keeps`);
  return path.join(skillDir(), workspace);
}

/** Notes `text` for the next read of a thread's tab. */
export function note(entry: Entry, key: string, text: string): void {
  if (!entry.notes.has(key)) entry.notes.set(key, []);
  entry.notes.get(key)!.push(text);
}

/** What happened in a thread's tab since the last read, taken. */
export function takeNotes(entry: Entry, key: string): string[] {
  const notes = entry.notes.get(key) ?? [];
  entry.notes.set(key, []);
  return notes;
}

/** A chat's tab: its workspace's browser entry, its page, and its thread's key. */
export interface Tab {
  workspace: string;
  entry: Entry;
  page: Page;
  key: string;
}

/** The first line of what an error says. */
export const firstLine = (e: unknown): string => String((e as Error)?.message ?? e).split("\n")[0];
