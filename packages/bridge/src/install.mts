// Putting the runner on this machine.
//
// install     the runner pointed at an AnythingLLM's storage (its password), BRIDGE_ALLOW set to the
//             clients' when none is, the runner started under systemd where there is one, and the
//             developer key and settings of anythingllm-mcp's chat and schedule servers made
// uninstall   the runner stopped and the storage forgotten
// health      every check; false when one fails

import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chatRoutes, missingRules } from "./allow.mts";
import { readEnv, saveEnv } from "./envfile.mts";
import { invalid } from "./errors.mts";
import { developerKey } from "./pair.mts";
import * as service from "./service.mts";
import { fileFor, loadSettings, shown, type Env, type Settings } from "./settings.mts";
import { request, Upstream } from "./upstream.mts";

export interface Ctx {
  home: string;
  env: Env;
  print: (line: string) => void;
  /** The command that serves, for the service to run. */
  command: string[];
  /** What BRIDGE_ALLOW is set to when it is unset (contract/default-allow.txt). */
  defaultAllow: string;
  /** The service manager's commands; the real ones unless a test gives its own. */
  run?: service.Run;
  /** How many seconds a started bridge has to answer (60). */
  startWait?: number;
}

const AGENT_SERVERS = ["chat", "schedule"]; // anythingllm-mcp's servers that call the bridge
const AGENT_KEY_NAME = "anythingllm-mcp"; // the name of their one developer key
const AGENT_KEY = "ANYTHINGLLM_DEVELOPER_KEY";
const AGENT_URL = "ANYTHINGLLM_BRIDGE_URL";
const AGENT_HEADER = [
  "# anythingllm-mcp's settings for this server: the bridge's address and the developer key",
  "# it calls with. `anythingllm-bridge install` made them; the key is yours alone (mode 600).",
];

const agentKeyMade = (settings: Settings): boolean =>
  AGENT_SERVERS.some((n) => readEnv(path.join(settings.mcpEnvDir, `${n}.env`))[AGENT_KEY]);

/** The chat routes BRIDGE_ALLOW lacks, or null while no chat or schedule server has a key to call them with. */
const lackingChatRoutes = (ctx: Ctx, settings: Settings): string[] | null =>
  agentKeyMade(settings) ? missingRules(settings.allow, chatRoutes(ctx.defaultAllow)) : null;

const statusOf = async (url: string): Promise<number> => {
  try {
    return (await request(url, { timeout: 5_000 })).status;
  } catch {
    return 0;
  }
};

async function waitFor(url: string, seconds = 60): Promise<boolean> {
  for (const deadline = Date.now() + seconds * 1000; Date.now() < deadline; await sleep(500)) {
    if ((await statusOf(url)) === 200) return true;
  }
  return false;
}

export async function install(ctx: Ctx, opts: { storage: string; agentTools: boolean; start: boolean }): Promise<void> {
  const file = fileFor(ctx.env, ctx.home);
  const where = path.resolve(opts.storage.replace(/^~(?=\/|$)/, ctx.home));
  if (!fs.existsSync(path.join(where, "anythingllm.db")) && !fs.existsSync(path.join(where, "plugins"))) {
    throw invalid(`${where} doesn't look like AnythingLLM's storage`);
  }
  ctx.print(`AnythingLLM's storage: ${where}`);
  const changes: Record<string, string> = { ANYTHINGLLM_STORAGE: where };
  if (readEnv(file).BRIDGE_ALLOW === undefined) {
    changes.BRIDGE_ALLOW = ctx.defaultAllow;
    ctx.print(`BRIDGE_ALLOW: what its clients call, ${ctx.defaultAllow}`);
  }
  saveEnv(file, changes);
  const settings = loadSettings(ctx.env, ctx.home);
  if (opts.start) await start(ctx, settings, file);
  if (opts.agentTools) await agentTools(ctx, settings);
  leftForYou(ctx, settings, file);
}

async function start(ctx: Ctx, settings: Settings, file: string): Promise<void> {
  if (!service.usable(ctx.run)) {
    ctx.print("This machine has no systemd the bridge drives. Run `anythingllm-bridge serve` under your");
    ctx.print("own supervisor: a terminal, tmux, a container, a process manager. It reads the same settings file.");
    return;
  }
  if (service.define(ctx.home, service.unitText(ctx.command, file, settings.port), ctx.run)) ctx.print(`wrote the runner's service: ${service.UNIT}`);
  service.start(ctx.run);
  if (!(await waitFor(`http://127.0.0.1:${settings.port}/health`, ctx.startWait))) throw invalid(`the runner didn't answer; see \`journalctl --user -u ${service.UNIT}\``);
}

/** Gives anythingllm-mcp's chat and schedule servers the developer key named AGENT_KEY_NAME and
 *  the bridge's address, in `<MCP_ENV_DIR>/<server>.env`. A key or an address already there is the
 *  owner's and stays. The key is never printed. */
async function agentTools(ctx: Ctx, settings: Settings): Promise<void> {
  let key: string;
  try {
    key = await developerKey(Upstream.of(settings), AGENT_KEY_NAME);
  } catch (e) {
    ctx.print(`anythingllm-mcp: no developer key made (${(e as Error).message}); run install again once it answers`);
    return;
  }
  const wanted = { [AGENT_KEY]: key, [AGENT_URL]: `http://127.0.0.1:${settings.port}` };
  for (const name of AGENT_SERVERS) {
    const file = path.join(settings.mcpEnvDir, `${name}.env`);
    const have = readEnv(file);
    const changes = Object.fromEntries(Object.entries(wanted).filter(([k]) => !have[k]));
    if (Object.keys(changes).length) {
      saveEnv(file, changes, AGENT_HEADER);
      ctx.print(`anythingllm-mcp: ${file}: set ${Object.keys(changes).join(", ")}`);
    }
  }
}

/** What install could not do for the owner. */
function leftForYou(ctx: Ctx, settings: Settings, file: string): void {
  ctx.print("\nLeft for you:");
  if (!settings.envFile || !fs.existsSync(settings.envFile)) {
    ctx.print(`- AnythingLLM's .env isn't at ${settings.envFile}: set ANYTHINGLLM_ENV in ${file} (its password is the bridge's login).`);
  }
  if (!settings.allow.length) {
    ctx.print(`- BRIDGE_ALLOW is empty, so the bridge passes nothing: set it in ${file}.`);
  } else {
    const lacking = lackingChatRoutes(ctx, settings);
    if (lacking?.length) ctx.print(`- BRIDGE_ALLOW is your own and lacks the chat routes, so the chat server gets 403: add ${lacking.join(", ")} to ${file}.`);
  }
  ctx.print("- For clients: give the bridge an https address (README: Reach it from your devices).");
}

export function uninstall(ctx: Ctx): void {
  const unit = service.defined(ctx.home);
  const stopped = unit && service.stop(ctx.run);
  saveEnv(fileFor(ctx.env, ctx.home), { ANYTHINGLLM_STORAGE: null });
  if (stopped) ctx.print("Stopped the runner.");
  else if (unit) ctx.print(`Forgot the storage, but \`systemctl --user disable --now ${service.UNIT}\` failed: stop the service yourself.`);
  else ctx.print("Forgot the storage. Stop `anythingllm-bridge serve` yourself.");
}

type Check = [what: string, ok: boolean, detail: string];

/** Every health check; false when one failed. */
export async function health(ctx: Ctx): Promise<boolean> {
  const settings = loadSettings(ctx.env, ctx.home);
  const found: Check[] = [];
  if (service.defined(ctx.home)) {
    const state = service.status(ctx.run);
    found.push([service.UNIT, state === "active", state]);
  }
  const probe = (what: string, status: number, detail = ""): Check => [what, status === 200, `${detail}${status || "no answer"}`];
  const publicUrl = `${settings.publicUrl}/health`;
  const [bridge, ping, login, route] = await Promise.all([
    statusOf(`http://127.0.0.1:${settings.port}/health`),
    statusOf(`${settings.anythingllmUrl}/api/ping`),
    loginCheck(settings),
    settings.publicUrl ? statusOf(publicUrl).then((status) => probe(publicUrl, status)) : (["route", true, "PUBLIC_URL and PUBLIC_HOST unset: the bridge answers on this machine only"] as Check),
  ]);
  found.push(probe(`bridge on :${settings.port}`, bridge), probe("AnythingLLM", ping, `${settings.anythingllmUrl}: `), login);
  const allowed = shown(settings).BRIDGE_ALLOW;
  found.push(["BRIDGE_ALLOW", Boolean(allowed), allowed || "empty: the bridge passes nothing"]);
  const lacking = lackingChatRoutes(ctx, settings);
  if (lacking) found.push(["anythingllm-mcp's chat routes", !lacking.length, lacking.length ? `missing from BRIDGE_ALLOW: ${lacking.join(", ")}` : ""]);
  found.push(route);
  for (const [what, ok, detail] of found) ctx.print(`${ok ? "ok  " : "FAIL"} ${what}${detail ? `: ${detail}` : ""}`);
  return found.every(([, ok]) => ok);
}

async function loginCheck(settings: Settings): Promise<Check> {
  const name = "the internal API's login";
  try {
    const reply = await Upstream.of(settings).exchange("GET", "/system/api-keys");
    return [name, reply.status !== 401, reply.status === 401 ? "refused" : ""];
  } catch (e) {
    return [name, false, (e as Error).message];
  }
}
