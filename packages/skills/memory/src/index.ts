// The memory's index: every fact's text, kind and tags in one JSON file in AnythingLLM's storage
// (`memory-lean/memory.json`). It is the source of truth; the vectors AnythingLLM keeps for the
// facts are derived from it, so they can be made again when the embedder or the vector database
// changes. `synced` says, for each scope, what its vectors were made with (vectors.ts's
// fingerprint). A change to the index is made under `lock`, which survives a module reload.

import fs from "fs";
import path from "path";
import { writeAtomic } from "#shared/atomic";
import { MemoryError, type Index } from "./facts";

/** AnythingLLM's storage folder: STORAGE_DIR, else the folder three above the bundled handler.js
 *  (storage/plugins/agent-skills/memory-lean); that fallback holds only for the bundle's location. */
const storageDir = (): string => process.env.STORAGE_DIR || path.resolve(__dirname, "..", "..", "..");
const file = (): string => path.join(storageDir(), "memory-lean", "memory.json");

type LockState = { tail: Promise<unknown> };

/** Runs `fn` after every earlier `lock` call has finished. */
export function lock<T>(fn: () => Promise<T> | T): Promise<T> {
  const g = globalThis as { __memoryLeanLock?: LockState };
  const state = (g.__memoryLeanLock ||= { tail: Promise.resolve() });
  const run = state.tail.then(fn);
  state.tail = run.catch(() => {});
  return run;
}

/** The index as it is on disk; an empty one when there is none. A file that can't be read is an
 *  error, never replaced: it holds what the user asked to have remembered. */
export function load(): Index {
  let text: string;
  try {
    text = fs.readFileSync(file(), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { next: 1, synced: {}, facts: [] };
    throw e;
  }
  try {
    const index = JSON.parse(text) as Index;
    if (!Array.isArray(index.facts)) throw new Error("no facts list");
    index.synced ||= {};
    return index;
  } catch (e) {
    throw new MemoryError(`the memory's index (${file()}) can't be read (${(e as Error).message}); fix or move that file, and nothing is overwritten`);
  }
}

/** Writes the index whole, so a reader never sees half of it. */
export function save(index: Index): void {
  writeAtomic(file(), JSON.stringify(index, null, 1), 0o600);
}
