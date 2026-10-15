// The bridge's settings, read from its environment (which the settings file
// `~/.config/anythingllm-bridge/bridge.env` fills).
//
// | Name                   | Default                           | Meaning                          |
// | BRIDGE_PORT            | 8467                              | the port it listens on           |
// | BRIDGE_ALLOW           | (none; install sets the clients') | the internal routes it passes    |
// | PUBLIC_HOST            | (unset)                           | the HTTPS name devices use       |
// | PUBLIC_URL             | https://<PUBLIC_HOST>:<port>      | the bridge, for devices          |
// | ANYTHINGLLM_PUBLIC_URL | https://<PUBLIC_HOST>:<its port>  | AnythingLLM, for devices         |
// | APPS_URL               | (unset)                           | anythingllm-apps-v2, for devices |
// | ANYTHINGLLM_URL        | http://127.0.0.1:3001             | AnythingLLM, from here           |
// | ANYTHINGLLM_STORAGE    | (unset)                           | AnythingLLM's storage folder     |
// | ANYTHINGLLM_ENV        | <storage>/.env                    | its .env, with the password      |
// | MCP_ENV_DIR            | ~/.config/anythingllm-mcp         | anythingllm-mcp's env files      |

import path from "node:path";
import { parseRules, show, type Rule } from "./allow.mts";
import { readEnv } from "./envfile.mts";
import { invalid } from "./errors.mts";
import { phoneUrl } from "./pair.mts";

const PORT = 8467;
const ANYTHINGLLM_PORT = 3001;
const ANYTHINGLLM_URL = `http://127.0.0.1:${ANYTHINGLLM_PORT}`;

export interface Settings {
  port: number;
  allow: Rule[];
  publicHost: string;
  publicUrl: string | null;
  anythingllmPublicUrl: string | null;
  appsUrl: string | null;
  anythingllmUrl: string;
  storage: string | null;
  envFile: string | null;
  mcpEnvDir: string;
}

export type Env = Record<string, string | undefined>;

/** The settings as `settings` prints them. */
export function shown(s: Settings): Record<string, string> {
  return {
    BRIDGE_PORT: String(s.port),
    BRIDGE_ALLOW: s.allow.map(show).join(", "),
    PUBLIC_HOST: s.publicHost,
    PUBLIC_URL: s.publicUrl ?? "",
    ANYTHINGLLM_PUBLIC_URL: s.anythingllmPublicUrl ?? "",
    APPS_URL: s.appsUrl ?? "",
    ANYTHINGLLM_URL: s.anythingllmUrl,
    ANYTHINGLLM_STORAGE: s.storage ?? "",
    ANYTHINGLLM_ENV: s.envFile ?? "",
    MCP_ENV_DIR: s.mcpEnvDir,
  };
}

/** The settings from environment values; `home` is the user's home folder. */
export function fromEnv(env: Env, home: string): Settings {
  const get = (name: string): string => (env[name] ?? "").trim();
  const url = (name: string, fallback: string | null): string | null => {
    const raw = get(name);
    if (!raw) return fallback;
    try {
      return phoneUrl(raw);
    } catch (e) {
      throw invalid(`${name}: ${(e as Error).message}`);
    }
  };
  const rawPort = get("BRIDGE_PORT") || String(PORT);
  if (!/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) throw invalid(`BRIDGE_PORT must be a port number, not ${JSON.stringify(rawPort)}`);
  const port = Number(rawPort);
  const host = get("PUBLIC_HOST");
  const onHost = (p: number): string | null => (host ? `https://${host}:${p}` : null);
  const anythingllmUrl = (get("ANYTHINGLLM_URL") || ANYTHINGLLM_URL).replace(/\/+$/, "");
  const anythingllmPort = Number(new URL(anythingllmUrl).port) || ANYTHINGLLM_PORT;
  const storage = get("ANYTHINGLLM_STORAGE") || null;
  return {
    port,
    allow: parseRules(get("BRIDGE_ALLOW")),
    publicHost: host,
    publicUrl: url("PUBLIC_URL", onHost(port)),
    anythingllmPublicUrl: url("ANYTHINGLLM_PUBLIC_URL", onHost(anythingllmPort)),
    appsUrl: url("APPS_URL", null),
    anythingllmUrl,
    storage,
    envFile: get("ANYTHINGLLM_ENV") || (storage ? path.join(storage, ".env") : null),
    mcpEnvDir: get("MCP_ENV_DIR") || path.join(home, ".config", "anythingllm-mcp"),
  };
}

export const settingsFile = (home: string): string => path.join(home, ".config", "anythingllm-bridge", "bridge.env");

/** The settings file: BRIDGE_ENV_FILE when set (another file, to run a second bridge), else the user's. */
export const fileFor = (env: Env, home: string): string => env.BRIDGE_ENV_FILE || settingsFile(home);

/** The settings: the environment's own values over the settings file's. */
export const loadSettings = (env: Env, home: string): Settings => fromEnv({ ...readEnv(fileFor(env, home)), ...env }, home);
