#!/usr/bin/env node
// anythingllm-bridge: `serve` runs the bridge; `pair` prints the link a phone connects with;
// `install`, `uninstall` and `health` deploy it (install.mts); `settings` prints the settings in use.

import fs from "node:fs";
import os from "node:os";
import { parseArgs } from "node:util";
import defaultAllow from "../../../contract/default-allow.txt";
import { invalid } from "./errors.mts";
import { health, install, uninstall, type Ctx } from "./install.mts";
import { developerKey, pairingLink } from "./pair.mts";
import { createServer } from "./server.mts";
import { fileFor, loadSettings, shown } from "./settings.mts";
import { Upstream } from "./upstream.mts";

const USAGE = `usage: anythingllm-bridge <command>

  serve                          run the bridge
  install --storage DIR          point it at AnythingLLM's storage and start it
          [--no-start] [--no-agent-tools]
  uninstall                      stop it and forget the storage
  health                         check it; exit 1 when a check fails
  pair [--url U] [--bridge U] [--apps U]
                                 print the link AnythingLLM Lite connects with (it holds the key)
  settings                       print the settings in use
`;

const ctx: Ctx = {
  home: os.homedir(),
  env: process.env,
  print: console.log,
  command: [process.execPath, fs.realpathSync(process.argv[1]), "serve"],
  defaultAllow: defaultAllow.trim(),
};

async function main(argv: string[]): Promise<number | void> {
  const [command, ...rest] = argv;
  const { values } = parseArgs({
    args: rest,
    options: {
      storage: { type: "string" },
      "no-start": { type: "boolean" },
      "no-agent-tools": { type: "boolean" },
      url: { type: "string" },
      bridge: { type: "string" },
      apps: { type: "string" },
    },
  });
  switch (command) {
    case "serve": {
      const settings = loadSettings(ctx.env, ctx.home);
      const server = createServer({ rules: settings.allow, upstream: Upstream.of(settings), log: console.error });
      server.on("error", (e) => {
        console.error(`anythingllm-bridge: ${e.message}`);
        process.exit(1);
      });
      server.listen(settings.port, "127.0.0.1", () => console.error(`the bridge on :${settings.port}, passing ${settings.allow.length} routes`));
      for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => process.exit(0));
      return; // runs until stopped
    }
    case "install":
      if (!values.storage) throw invalid("say which AnythingLLM: --storage DIR");
      await install(ctx, { storage: values.storage, agentTools: !values["no-agent-tools"], start: !values["no-start"] });
      return 0;
    case "uninstall":
      uninstall(ctx);
      return 0;
    case "health":
      return (await health(ctx)) ? 0 : 1;
    case "pair": {
      const settings = loadSettings(ctx.env, ctx.home);
      const address = values.url || settings.anythingllmPublicUrl;
      if (!address) throw invalid("no address for AnythingLLM: set ANYTHINGLLM_PUBLIC_URL or PUBLIC_HOST in the settings, or pass --url");
      const key = await developerKey(Upstream.of(settings));
      console.error(`Open this in AnywhereLLM Lite to connect to ${address}. It holds the key:`);
      console.log(pairingLink(address, key, values.bridge || settings.publicUrl, values.apps || settings.appsUrl));
      return 0;
    }
    case "settings":
      console.log(`# from ${fileFor(ctx.env, ctx.home)} and the environment`);
      for (const [key, value] of Object.entries(shown(loadSettings(ctx.env, ctx.home)))) console.log(`${key}=${value}`);
      return 0;
    default:
      console.error(USAGE);
      return command ? 2 : 0;
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    if (code !== undefined) process.exit(code);
  },
  (e: unknown) => {
    console.error(`anythingllm-bridge: ${(e as Error).message}`);
    process.exit(1);
  },
);
