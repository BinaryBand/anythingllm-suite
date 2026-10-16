// Starts a lab of its own for the tests: a throwaway database, ports from `base` up, a fixed CAPTCHA answer
// and short approval and confirmation windows. stop() shuts it down and deletes the database.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const CAPTCHA = "24680";

export async function startLab({ base, env = {} }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "test-lab-"));
  const server = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "src/server.js"], {
    cwd: path.resolve(import.meta.dirname, ".."),
    env: { ...process.env, LAB_DB: path.join(dir, "lab.db"), LAB_BASE_PORT: String(base), LAB_FIXED_CAPTCHA: CAPTCHA, LAB_SECRET: "test", LAB_BIND: "127.0.0.1", LAB_PUSH_TTL: "2", LAB_SUDO_SECONDS: "2", LAB_MURMUR_SESSION_SECONDS: "3", LAB_MURMUR_LOCK_SECONDS: "3", LAB_MURMUR_QR_SECONDS: "1", ...env },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise((resolve, reject) => {
    server.stdout.on("data", (d) => String(d).includes("Test lab") && resolve());
    server.once("exit", (code) => reject(new Error(`the lab exited (${code}) before it started`)));
  });
  return {
    base,
    port: (offset) => base + offset,
    /** The newest code the lab's outbox holds for `to` on `site`. */
    lastCode: async (site, to) => (await (await fetch(`http://localhost:${base}/api/outbox?${new URLSearchParams({ site, to })}`)).json())[0]?.code,
    stop() {
      server.kill();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
