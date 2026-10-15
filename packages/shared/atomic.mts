import fs from "fs";
import path from "path";
import { serial } from "./anythingllm.mts";
import { Told } from "./errors.mts";

/** Writes `data` to `file` atomically, making its folder: a reader never sees half of it. */
export function writeAtomic(file: string, data: string | Uint8Array, mode = 0o644): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    fs.writeFileSync(temp, data, { mode });
    fs.renameSync(temp, file);
  } catch (e) {
    fs.rmSync(temp, { force: true });
    throw e;
  }
}

/** Whether `file` holds exactly `text`; false when there is no file. */
export const sameText = (file: string, text: string): boolean => fs.existsSync(file) && fs.readFileSync(file, "utf8") === text;

/** Writes `text` to `file` atomically unless it holds it already; whether it wrote. */
export function writeAtomicIfChanged(file: string, text: string, mode?: number): boolean {
  if (sameText(file, text)) return false;
  writeAtomic(file, text, mode);
  return true;
}

const LOCK_WAIT_MS = 5 * 1000;
const LOCK_STALE_MS = 10 * 1000;
const LOCK_RETRY_MS = 20;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs `fn` holding the lock folder `lock`: one process at a time (the folder is made, or waited
 *  for), and in this process one call at a time. `fn` should be quick and do no network, so the
 *  lock is held for milliseconds; a lock older than LOCK_STALE_MS is one a process left behind when
 *  it died, and is broken. `what` names what's locked in the Told said when it stays busy. */
export function locked<T>(lock: string, what: string, fn: () => T | Promise<T>): Promise<T> {
  return serial(`lock:${lock}`, async () => {
    fs.mkdirSync(path.dirname(lock), { recursive: true });
    const until = Date.now() + LOCK_WAIT_MS;
    for (;;) {
      try {
        fs.mkdirSync(lock);
        break;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      }
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) {
          fs.rmSync(lock, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue; // released meanwhile
      }
      if (Date.now() > until) throw new Told(`${what} is busy; try again in a moment`);
      await sleep(LOCK_RETRY_MS);
    }
    try {
      return await fn();
    } finally {
      fs.rmSync(lock, { recursive: true, force: true });
    }
  });
}

/** Changes the JSON file `file` under its lock (`file`.lock): `change` gets what it holds now (or
 *  `fresh` when there's none) and changes it in place; what it answers is answered. */
export function updateJson<S, T>(file: string, fresh: () => S, change: (value: S) => T): Promise<T> {
  return locked(`${file}.lock`, path.basename(file), () => {
    let value: S;
    try {
      value = JSON.parse(fs.readFileSync(file, "utf8")) as S;
    } catch {
      value = fresh();
    }
    const answer = change(value);
    writeAtomic(file, JSON.stringify(value, null, 2) + "\n", 0o600);
    return answer;
  });
}
