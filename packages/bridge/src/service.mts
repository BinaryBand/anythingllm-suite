// The runner as a systemd user unit, the one service manager the bridge drives. Anywhere else, or
// with no systemd, `serve` runs under the owner's own supervisor (a terminal, tmux, a container, a
// process manager) and reads the same settings file.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const UNIT = "anythingllm-bridge.service";

/** Runs a command, never through a shell. A command that isn't installed reads as a failed run. */
export type Run = (command: string, args: string[]) => { status: number | null; stdout: string };

const run: Run = (command, args) => {
  const done = spawnSync(command, args, { encoding: "utf8" });
  return { status: done.status, stdout: done.stdout ?? "" };
};

const unitFile = (home: string): string => path.join(home, ".config", "systemd", "user", UNIT);

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

/** Whether this machine runs systemd (as sd_booted does: /run/systemd/system) and has systemctl. */
export const usable = (r: Run = run): boolean => process.platform === "linux" && fs.existsSync("/run/systemd/system") && r("systemctl", ["--version"]).status === 0;

/** Writes the unit; whether it changed. */
export function define(home: string, text: string, r: Run = run): boolean {
  const file = unitFile(home);
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === text) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  r("systemctl", ["--user", "daemon-reload"]);
  return true;
}

/** Whether the bridge runs as a unit here: systemd is there and `install` defined the unit. */
export const managed = (home: string, r: Run = run): boolean => usable(r) && fs.existsSync(unitFile(home));

export function start(r: Run = run): void {
  r("systemctl", ["--user", "enable", UNIT]);
  if (r("systemctl", ["--user", "restart", UNIT]).status !== 0) throw new Error(`systemctl restart ${UNIT} failed; see \`journalctl --user -u ${UNIT}\``);
}

export function stop(r: Run = run): void {
  r("systemctl", ["--user", "disable", "--now", UNIT]);
}

export const status = (r: Run = run): string => r("systemctl", ["--user", "is-active", UNIT]).stdout.trim();
