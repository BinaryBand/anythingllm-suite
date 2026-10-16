import assert from "node:assert/strict";
import { test } from "node:test";
import { SAMPLES } from "./harness.mts";
import { file } from "../src/parts.ts";
import { problems, unknownKeywords, withDefaults } from "../src/schema.ts";

/** The components static/ holds, by file name. */
const components = (): string[] => Object.keys(STATIC_FILES).filter((f) => f.startsWith("parts/components/")).map((f) => f.slice("parts/components/".length));

test("every starter's data satisfies its schema, which uses known keywords only", () => {
  for (const [name, s] of Object.entries(SAMPLES)) {
    assert.deepEqual(unknownKeywords(s.schema), [], name);
    assert.deepEqual(problems(s.data, s.schema), [], name);
  }
});

test("problems name the path and what is wrong", () => {
  const schema = SAMPLES.list.schema;
  assert.deepEqual(problems({ items: [{ text: "", done: "no" }] }, schema), ["/items/0/text: shorter than 1", "/items/0/done: should be boolean, not string"]);
  assert.deepEqual(problems({}, schema), ["/: needs items"]);
  assert.deepEqual(problems(3, { type: "integer", maximum: 2 }), ["/: above 2"]);
  assert.deepEqual(problems(2.5, { type: "integer" }), ["/: should be integer, not number"]);
});

test("an unknown keyword is reported where it is", () => {
  assert.deepEqual(unknownKeywords({ type: "object", properties: { a: { oneOf: [] } } }), ["/properties/a/oneOf"]);
});

test("an object's keys are counted against minProperties and maxProperties", () => {
  const schema = { type: "object", minProperties: 1, maxProperties: 2 };
  assert.deepEqual(problems({}, schema), ["/: fewer than 1 keys"]);
  assert.deepEqual(problems({ a: 1, b: 2 }, schema), []);
  assert.deepEqual(problems({ a: 1, b: 2, c: 3 }, schema), ["/: more than 2 keys"]);
  assert.deepEqual(unknownKeywords(schema), []);
});

test("every schema the components carry is one this checker knows every keyword of", () => {
  for (const name of components()) {
    const head = /^<!--part\n([\s\S]*?)\n-->/.exec(file(`parts/components/${name}`))!;
    const { schema } = JSON.parse(head[1]);
    if (schema) assert.deepEqual(unknownKeywords(schema), [], name);
  }
});

test("first data gets a zero for each required key it lacks, where the zero is allowed", () => {
  const schema = { type: "object", required: ["items", "goal", "name"], properties: { goal: { type: "integer", minimum: 1 }, name: { type: "string" },
    items: { type: "array", items: { type: "object", required: ["text", "done"], properties: { text: { type: "string" }, done: { type: "boolean" } } } } } };
  assert.deepEqual(withDefaults({ items: [{ text: "Eggs" }, { text: "Milk", done: true }] }, schema), {
    value: { items: [{ text: "Eggs", done: false }, { text: "Milk", done: true }] }, filled: ["items/[]/done"] });
  assert.deepEqual(withDefaults({}, schema), { value: { items: [] }, filled: ["items"] }, "a string, and a number whose zero breaks its minimum, stay for the schema check");
});

test("uniqueItems compares values, not their text: key order is no difference, and a string is not the list it spells", () => {
  const unique = { type: "array", uniqueItems: true };
  assert.deepEqual(problems([1, 2, 3], unique), []);
  assert.equal(problems([1, 2, 1], unique).length, 1);
  assert.equal(problems([{ a: 1, b: 2 }, { b: 2, a: 1 }], unique).length, 1);
  assert.deepEqual(problems([{ a: 1 }, { a: 2 }], unique), []);
  assert.deepEqual(problems(["[1]", [1]], unique), []);
  assert.deepEqual(problems([1, "1"], unique), []);
});
