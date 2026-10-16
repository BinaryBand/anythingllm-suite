// What the agent reads stays small: every token of it is carried through the rest of the
// session, and the time an agent took to build an app followed how much it read. Tokens are
// counted at four characters each. A limit sits just above
// what is read now, so growth is a decision made here rather than a drift.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { call, PLAN, skillDir } from "./harness.mts";
import * as parts from "../src/parts.ts";

const plugin = JSON.parse(fs.readFileSync(path.join(skillDir, "plugin.json"), "utf8"));
const tokens = (text: string) => Math.ceil(text.length / 4);
const within = (text: string, limit: number, what: string) => assert.ok(tokens(text) <= limit, `${what}: ${tokens(text)} tokens, over ${limit}`);
const ask = (params: Record<string, unknown>) => call("home", params);

test("what the agent reads on every turn: the description, parameters and examples", () => {
  within(plugin.description, LIMITS.description, "description");
  within(JSON.stringify([plugin.description, plugin.entrypoint.params, plugin.examples]), LIMITS.everyTurn, "every turn");
});

test("the bare guide and each topic", async () => {
  within(await ask({ action: "guide" }), LIMITS.bareGuide, "bare guide");
  for (const topic of ["runtime", "check", ...parts.topicNames(), ...Object.keys(parts.starters()), ...Object.keys(parts.parts())])
    within(parts.guide(topic), parts.starters()[topic] ? LIMITS.starterTopic : LIMITS.topic, topic);
  // app.css itself, the one way to learn what a class looks like.
  within(parts.guide("styles"), LIMITS.styles, "styles");
});

test("the answers to create, do, read and list", async () => {
  for (const name of Object.keys(parts.starters())) within(await ask({ action: "create", name, starter: name }), LIMITS.createStarter, `create ${name}`);
  const text = JSON.stringify({ about: "A list.", rules: [], schema: { type: "object" }, card: {} });
  within(await ask({ action: "create", name: "plain", plan: PLAN, template: "column", text, data: {} }), LIMITS.createTemplate, "create from a template");
  within(await ask({ action: "do", name: "checklist", ev: "add", patch: [{ op: "add", path: "/items/-", value: { text: "Eggs", done: false } }] }), LIMITS.do, "do");
  within(await ask({ action: "read", name: "checklist" }), LIMITS.read, "read");
  within(await ask({ action: "list" }), LIMITS.list, "list");
});

// Measured 2026-10-16 in the suite, after the form went (open and its sentence out of the
// description and the action list): description 164 to 157, every turn 754 to 745.
// Measured 2026-10-14 after create asked for a plan without a starter and a live run made three
// Wordles: everyTurn 754 (limit 755 to 760: the plan param, 37), list 178 to 196 (limit 205: one line
// telling the agent to make one app). The refusal's checklist is 158, read only when a plan is missing.
// Measured 2026-10-14 after folding show, write and revert into read, edit and undo, and moving
// how to make an app out of the description into list's answer, which the agent reads first:
// description 164, every turn 717, read (show before) 204, list 178.
// Measured 2026-10-13 after trimming the description, examples and notes, with create taking
// parts (description 222, every turn 731, bare guide 942, largest topic 1103, styles 1999,
// do 39, show 194), each limit about 5% over. create answers with app.json and page.html as
// made (largest 1252, from a template 393): the agent read both straight after otherwise, a
// step for the same text. The focus-timer starter logs each finished session itself, which
// its topic (251) carries: the agent would otherwise rewrite the page to do it.
// Components repeat over a list (App.mount), which design rule 2 and the
// habits starter add to the bare guide (1035), and App.mount's reference adds to the runtime
// every component topic carries (largest, item-list, 1263).
// The explainer starter carries the pager's screen schema (figure, code, lines, tree, sources),
// the format the agent writes every screen in, and research rules: its topic is 523 and its
// create 1319; every other starter's topic is under 265.
const LIMITS = { description: 175, everyTurn: 760, bareGuide: 1085, topic: 1300, starterTopic: 555, styles: 2100, createStarter: 1345, createTemplate: 415, do: 60, read: 215, list: 290 };
