// What the agent reads stays small: every token of it is carried through the rest of the session,
// and the time an agent took to build an app followed how much it read. Tokens are counted at four
// characters each. Each thing the agent reads has its size recorded in budgets.json, and the test
// fails when one grows past it by more than ALLOWED, shrinks under it by twice that, or isn't (or is
// no longer) recorded: a size is a decision made in that file's diff, with its reason in the commit,
// never a drift under one limit for many.
// APPS_BUDGETS=update writes what is read now as the new record.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { call, PLAN, skillDir, testsDir } from "./harness.mts";
import * as parts from "../src/parts.ts";

const RECORD = path.join(testsDir, "budgets.json");
/** How much one thing may grow past its record before the test fails: 5%, and at least 10 tokens. */
const ALLOWED = (recorded: number) => Math.max(10, Math.ceil(recorded * 0.05));

const plugin = JSON.parse(fs.readFileSync(path.join(skillDir, "plugin.json"), "utf8"));
const tokens = (text: string) => Math.ceil(text.length / 4);
const ask = (params: Record<string, unknown>) => call("home", params);

test("what the agent reads stays within what budgets.json records for it", async () => {
  const read: Record<string, number> = {};
  read["description"] = tokens(plugin.description);
  read["every turn"] = tokens(JSON.stringify([plugin.description, plugin.entrypoint.params, plugin.examples]));
  read["guide"] = tokens(await ask({ action: "guide" }));
  for (const topic of ["runtime", "check", "styles", ...parts.topicNames(), ...Object.keys(parts.starters()), ...Object.keys(parts.parts())]) read[`guide ${topic}`] = tokens(parts.guide(topic));
  for (const name of Object.keys(parts.starters())) read[`create ${name}`] = tokens(await ask({ action: "create", name, starter: name }));
  const text = JSON.stringify({ about: "A list.", rules: [], schema: { type: "object" }, card: {} });
  read["create from a template"] = tokens(await ask({ action: "create", name: "plain", plan: PLAN, template: "column", text, data: {} }));
  read["do"] = tokens(await ask({ action: "do", name: "checklist", ev: "add", patch: [{ op: "add", path: "/items/-", value: { text: "Eggs", done: false } }] }));
  read["read"] = tokens(await ask({ action: "read", name: "checklist" }));
  read[`list of ${Object.keys(parts.starters()).length + 1} apps`] = tokens(await ask({ action: "list" }));

  if (process.env.APPS_BUDGETS === "update") return void fs.writeFileSync(RECORD, JSON.stringify(read, null, 2) + "\n");
  const recorded: Record<string, number> = JSON.parse(fs.readFileSync(RECORD, "utf8"));
  // Off the record either way: grown past it, shrunk well under it (so the record keeps up and what
  // was saved can't grow back unseen), new, or recorded and no longer read.
  const off = [
    ...Object.entries(read)
      .filter(([what, now]) => !(what in recorded) || Math.abs(now - recorded[what]) > (now > recorded[what] ? 1 : 2) * ALLOWED(recorded[what]))
      .map(([what, now]) => (what in recorded ? `${what}: ${now} tokens, recorded ${recorded[what]}` : `${what}: ${now} tokens, not recorded`)),
    ...Object.keys(recorded).filter((what) => !(what in read)).map((what) => `${what}: recorded, no longer read`),
  ];
  assert.deepEqual(off, [], "off budgets.json; if that's meant, record it: APPS_BUDGETS=update npm run skills:test");
});
