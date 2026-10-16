import assert from "node:assert/strict";
import { test } from "node:test";
import "./harness.mts";
import * as parts from "../src/parts.ts";

const column = parts.template("column");
/** The column template with `markup` at its slot and `script` at its scripts. */
const bare = (markup: string, script?: string) => column.replace("<!--slot-->", markup).replace("<!--scripts-->", script ? `<script>${script}</script>` : "");

test("a page from a template and its components has no problems", () => {
  assert.deepEqual(parts.pageProblems(parts.compose(column, "counter")), []);
});

test("an element id given twice is refused, and one a script builds into markup is not counted", () => {
  assert.deepEqual(parts.pageProblems(bare('<p id="a"></p><p id="b"></p><p id="a"></p>')), ['page.html gives the id "a" to more than one element: an id is one element\'s']);
  assert.deepEqual(parts.pageProblems(bare('<p id="a"></p>', 'document.body.insertAdjacentHTML("beforeend", \'<p id="a"></p>\');')), []);
});

test("$(id) of an element the markup never gives is refused", () => {
  assert.deepEqual(parts.pageProblems(bare('<p id="here"></p>', '$("here").hidden = true; $("gone").hidden = true;')), ['page.html\'s scripts look up $("gone"), but no element has id="gone"']);
});

test("$(id) is not judged where a script makes elements with ids, or $ isn't getElementById", () => {
  assert.deepEqual(parts.pageProblems(bare("", 'document.body.append(el("p", { id: "made" })); $("made").hidden = true;')), []);
  assert.deepEqual(parts.pageProblems(bare("", 'const made = el("p", {}); made.setAttribute("id", "late"); document.body.append(made); $("late").hidden = true;')), []);
  const own = parts.template("column").replace("const $ = (id) => document.getElementById(id);", 'const $ = (css) => document.querySelector(css);').replace("<!--scripts-->", '<script>$("#title").hidden = true;</script>');
  assert.deepEqual(parts.pageProblems(own).filter((p) => p.includes("look up $(")), []);
});

test("a component's script twice is refused", () => {
  const twice = parts.compose(parts.compose(column, "counter"), "counter");
  assert.deepEqual(parts.pageProblems(twice), ["page.html has the script for counter more than once: each component's script goes in once"]);
});

test("a script that doesn't parse is said once, with its line", () => {
  const broken = bare("", "return () => {");
  const found = parts.pageProblems(broken);
  assert.equal(found.length, 1);
  assert.match(found[0], /^page\.html's script 2 of 2 doesn't parse: Illegal return statement at: return \(\) => \{$/);
});

test("the check's stand-ins reach nothing of the skill's: a page can't get at Node through them", () => {
  const tries = [
    'App.set.constructor("return process")().env.APPS_ESCAPED = "set";',
    'console.log.constructor("return process")().env.APPS_ESCAPED = "log";',
    'App.data.constructor.constructor("return process")().env.APPS_ESCAPED = "proxy";',
    'this.constructor.constructor("return process")().env.APPS_ESCAPED = "global";',
    'App.mount("x", (part) => () => part.q.constructor("return process")().env.APPS_ESCAPED = "mount");',
  ];
  for (const code of tries) {
    parts.pageProblems(bare('<div data-part="x"></div>', `${code}\nApp.mount("x", () => () => {});`));
    assert.equal(process.env.APPS_ESCAPED, undefined, code);
  }
});

test("a page that loops forever is stopped, in its script, a draw or an onchange, and the check goes on", () => {
  const started = Date.now();
  for (const code of ["while (true) {}", 'App.mount("x", () => () => { for (;;) {} });', "App.onchange(() => { while (true) {} });", "Promise.resolve().then(() => { for (;;) {} });"]) {
    const found = parts.pageProblems(bare('<div data-part="x"></div>', `${code}\nApp.mount("x", () => () => {});`));
    assert.deepEqual(found.filter((p) => !p.includes("more than once")), [], code);
  }
  assert.ok(Date.now() - started < 10_000, "each is stopped at its timeout");
  assert.deepEqual(parts.pageProblems(bare("", "App.onchange(() => draw());")), ["page.html uses draw, which no script declares when it draws (script 2, line 1): the page stops there"], "the rest is still judged");
});
