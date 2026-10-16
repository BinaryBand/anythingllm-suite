// A throwaway AnythingLLM for one eval run: the pinned image (contract/versions.env) on a free port,
// its storage in a folder of the run's own, the suite installed into it as `install` does, a
// developer key and a session token. The model settings are the live instance's, read from its .env
// when the run starts and kept only in the run's folder, which stop() empties. The vault's key is a
// file both sides share (VAULT_KEY_FILE), so the harness can clear saved logins between cases.

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "../..");
const versions = Object.fromEntries(
  fs
    .readFileSync(path.join(ROOT, "contract/versions.env"), "utf8")
    .split("\n")
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => l.split(/=(.*)/s).slice(0, 2)),
);
export const INNER_STORAGE = versions.INNER_STORAGE;
/** Where the stand-in user's script is inside the container. */
export const ACTOR = "/eval/actor.cjs";
const KEY_INSIDE = "/eval/vault.key";
/** The live instance's settings a run copies: the model, and how many tool calls an agent gets. */
const COPIED = /^(LLM_PROVIDER|[A-Z_]+_MODEL_PREF|[A-Z_]+_API_KEY|GENERIC_OPEN_AI_[A-Z_]+|OPENROUTER_[A-Z_]+|OLLAMA_[A-Z_]+|AGENT_MAX_TOOL_CALLS)=/;

export interface Instance {
  name: string;
  url: string;
  /** The developer API's key (workspaces, threads). */
  key: string;
  /** A session token for the routes the web interface uses (its stream-chat and agent socket). */
  token: string;
  storage: string;
  /** The vault's key, outside the storage, as VAULT_KEY_FILE names it. */
  keyFile: string;
  /** Stops the container and removes the run's folder (the copied settings, the key, the storage);
   *  with `keep`, the folder stays, for looking into. */
  stop(keep?: boolean): void;
}

let found: string | null = null;
/** podman, else docker. */
const engine = (): string => {
  for (const e of found ? [] : ["podman", "docker"]) {
    try {
      execFileSync(e, ["--version"], { stdio: "ignore" });
      found = e;
    } catch {}
    if (found) break;
  }
  if (!found) throw new Error("tools/eval: needs podman or docker");
  return found;
};

const freePort = (): Promise<number> =>
  new Promise((resolve) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });

/** The .env lines of the live instance a run copies, quotes taken off. */
function copiedSettings(file: string): string[] {
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => COPIED.test(l))
    .map((l) => l.replace(/^([A-Z_]+)='(.*)'$/, "$1=$2"));
}

async function waitFor(url: string, what: string): Promise<void> {
  for (let i = 0; i < 90; i++) {
    if (await fetch(url).then((r) => r.ok, () => false)) return;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`tools/eval: ${what} didn't answer at ${url}`);
}

async function json(url: string, init: RequestInit): Promise<any> {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`tools/eval: ${init.method ?? "GET"} ${url}: ${r.status} ${await r.text()}`);
  return r.json();
}

/** Starts the instance: `env` is the live instance's .env to copy the model settings from. */
export async function start({ env = "/srv/anythingllm/storage/.env", work = fs.mkdtempSync(path.join(os.tmpdir(), "allm-eval-")) } = {}): Promise<Instance> {
  const run = engine();
  const podman = path.basename(run) === "podman";
  const storage = path.join(work, "storage");
  fs.mkdirSync(storage, { recursive: true, mode: 0o700 });
  fs.chmodSync(work, 0o700);
  const keyFile = path.join(work, "vault.key");
  fs.writeFileSync(keyFile, crypto.randomBytes(32).toString("base64") + "\n", { mode: 0o600 });
  const password = crypto.randomBytes(12).toString("base64url");
  const envFile = path.join(work, "container.env");
  const lines = [...copiedSettings(env), "AGENT_AUTO_APPROVED_SKILLS=<all>", `AUTH_TOKEN=${password}`, `JWT_SECRET=${crypto.randomBytes(18).toString("base64url")}`, `STORAGE_DIR=${INNER_STORAGE}`, `VAULT_KEY_FILE=${KEY_INSIDE}`];
  fs.writeFileSync(envFile, lines.join("\n") + "\n", { mode: 0o600 });
  // The password in the storage's .env, where `install` and the internal API's login read it.
  fs.writeFileSync(path.join(storage, ".env"), `AUTH_TOKEN=${password}\n`, { mode: 0o600 });

  const port = await freePort();
  const name = `allm-eval-${process.pid}`;
  const z = podman ? ",Z" : "";
  execFileSync(run, [
    "run", "-d", "--rm", "--name", name, "-p", `127.0.0.1:${port}:${versions.INNER_PORT}`,
    ...(podman ? ["--userns=keep-id:uid=1000,gid=1000"] : []),
    "-v", `${storage}:${INNER_STORAGE}${z.replace(",", ":")}`,
    "-v", `${path.join(HERE, "actor.cjs")}:${ACTOR}:ro${z}`,
    "-v", `${keyFile}:${KEY_INSIDE}:ro${z}`,
    "--env-file", envFile, versions.IMAGE,
  ], { stdio: ["ignore", "ignore", "inherit"] });
  const url = `http://127.0.0.1:${port}`;
  const stop = (keep = false) => {
    try {
      execFileSync(run, ["stop", "-t", "5", name], { stdio: "ignore" });
    } catch {}
    fs.rmSync(keep ? envFile : work, { recursive: true, force: true }); // the copied provider keys go either way
  };
  try {
    await waitFor(`${url}/api/ping`, "AnythingLLM");
    execFileSync("node", ["build.mjs", "bridge"], { cwd: path.join(ROOT, "packages"), stdio: "ignore" });
    execFileSync("node", [path.join(ROOT, "packages/bridge/dist/anythingllm-suite.cjs"), "install", "--storage", storage, "--roles", "chat,schedule", "--skills", "all"], { env: { ...process.env, ANYTHINGLLM_URL: url }, stdio: "ignore" });
    const headers = { "Content-Type": "application/json" };
    const { token } = await json(`${url}/api/request-token`, { method: "POST", headers, body: JSON.stringify({ password }) });
    const { apiKey } = await json(`${url}/api/system/generate-api-key`, { method: "POST", headers: { ...headers, Authorization: `Bearer ${token}` }, body: JSON.stringify({ name: "eval" }) });
    return { name, url, key: apiKey.secret, token, storage, keyFile, stop };
  } catch (e) {
    stop();
    throw e;
  }
}

/** Runs the stand-in user's script in the instance's container: `node actor.cjs <args>`. */
export function actor(instance: Instance, args: string[]): string {
  return execFileSync(engine(), ["exec", instance.name, "node", ACTOR, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** Deletes the saved logins and passkeys for `hosts` from the instance's vault, as a case starts that
 *  must find none (the vault is the instance's, shared by every workspace); answers how many went.
 *  The vault's own lock keeps this from racing the skill. */
export async function forgetLogins(at: Instance, hosts: string[]): Promise<number> {
  process.env.VAULT_KEY_FILE = at.keyFile;
  const vault = await import("../../packages/shared/vault.mts");
  return vault.update((v) => {
    const before = v.entries.length;
    v.entries = v.entries.filter((e) => !((e.kind === "password" || e.kind === "passkey") && hosts.includes(e.site)));
    return before - v.entries.length;
  }, path.join(at.storage, "vault-lean"));
}
