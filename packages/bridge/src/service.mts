// The runner as a systemd user unit, the one service manager the bridge drives. Anywhere else, or
// with no systemd, `serve` runs under the owner's own supervisor (a terminal, tmux, a container, a
// process manager) and reads the same settings file.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { writeAtomic } from "#shared/atomic";

export const UNIT = "anythingllm-bridge.service";

/** Runs a command, never through a shell. A command that isn't installed reads as a failed run. */
export type Run = (command: string, args: string[]) => { status: number | null; stdout: string };

const run: Run = (command, args) => {
  const done = spawnSync(command, args, { encoding: "utf8" });
  return { status: done.status, stdout: done.stdout ?? "" };
};

export const unitFile = (home: string): string => path.join(home, ".config", "systemd", "user", UNIT);

const quote = (word: string): string => (/[\s"'\\$%]/.test(word) ? `"${word.replace(/[\\"]/g, "\\$&").replace(/%/g, "%%").replace(/\$/g, "$$$$")}"` : word);

export function unitText(command: string[], envFile: string, port: number): string {
  return `# anythingllm-bridge's runner: the bridge to AnythingLLM's internal API (:${port}). Written by
# \`anythingllm-bridge install\` into ~/.config/systemd/user/; its settings are ${envFile}.
[Unit]
Description=anythingllm-bridge: a bridge to AnythingLLM's internal API (:${port})

[Service]
EnvironmentFile=${envFile}
ExecStart=${command.map(quote).join(" ")}
Restart=on-failure
RestartSec=10
TimeoutStopSec=20

[Install]
WantedBy=default.target
`;
}

/** Whether the user's systemd manager answers: no systemctl, or no reachable user manager (an ssh
 *  session without a user bus), reads as an empty answer. */
export const usable = (r: Run = run): boolean => ["running", "degraded", "starting"].includes(r("systemctl", ["--user", "is-system-running"]).stdout.trim());

/** Writes the unit; whether it changed. */
export function define(home: string, text: string, r: Run = run): boolean {
  const file = unitFile(home);
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === text) return false;
  writeAtomic(file, text);
  r("systemctl", ["--user", "daemon-reload"]);
  return true;
}

/** Whether `install` defined the unit. */
export const defined = (home: string): boolean => fs.existsSync(unitFile(home));

export function start(r: Run = run): void {
  r("systemctl", ["--user", "enable", UNIT]);
  if (r("systemctl", ["--user", "restart", UNIT]).status !== 0) throw new Error(`systemctl restart ${UNIT} failed; see \`journalctl --user -u ${UNIT}\``);
}

/** Stops the unit and keeps it from starting again; whether systemctl agreed. */
export const stop = (r: Run = run): boolean => r("systemctl", ["--user", "disable", "--now", UNIT]).status === 0;

export const status = (r: Run = run): string => r("systemctl", ["--user", "is-active", UNIT]).stdout.trim();
