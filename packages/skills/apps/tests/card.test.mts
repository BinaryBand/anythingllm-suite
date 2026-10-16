import assert from "node:assert/strict";
import { test } from "node:test";
import { card, ROWS } from "../src/card.ts";

test("a list's card is a table of ☑ and ☐ under its title and what is left", () => {
  const app = { title: "Groceries", card: { items: "/items" }, data: { items: [{ text: "Eggs", done: true }, { text: "Milk", done: false }] } };
  assert.deepEqual(card(app), ["| | **Groceries** · 1 of 2 left |", "|---|---|", "| ☑ | ~~Eggs~~ |", "| ☐ | Milk |"]);
});

test("a summary reads pointers and lengths, and long lists are cut", () => {
  const events = Array.from({ length: ROWS + 2 }, (_, i) => ({ title: `E${i}` }));
  const lines = card({ title: "Cal", card: { items: "/events", text: "title", summary: "{/events/length} events, first {/events/0/title}" }, data: { events } });
  assert.equal(lines[0], `**Cal** · ${ROWS + 2} events, first E0`);
  assert.equal(lines.at(-1), "- …and 2 more");
  assert.equal(lines[2], "- E0");
});

test("missing values never break a card", () => {
  assert.deepEqual(card({ title: "T", card: { items: "/nope", summary: "{/x}" }, data: {} }), ["**T**"]);
});

test("a pipe or a line break in an item can't break the table", () => {
  const lines = card({ title: "T", card: { items: "/items" }, data: { items: [{ text: "a|b\nc", done: false }] } });
  assert.equal(lines.at(-1), "| ☐ | a\\|b c |");
});

test("a title with a pipe can't break the header row", () => {
  assert.equal(card({ title: "A|B", card: { items: "/i" }, data: { i: [{ text: "x", done: false }] } })[0], "| | **A\\|B** · 1 of 1 left |");
});

test("a summary that points at a list says how many it holds, not the list", () => {
  assert.equal(card({ title: "Kanban Board", card: { summary: "/cards" }, data: { cards: [{ t: "a" }, { t: "b" }] } })[0], "**Kanban Board** · 2 cards");
});

test("with an address the title opens the app's page, in a list's table and on its own", () => {
  const url = "http://x:3001/apps-lean/tok.html";
  const list = { title: "Groceries", card: { items: "/items" }, data: { items: [{ text: "Eggs", done: false }] } };
  assert.deepEqual(card(list, url).slice(0, 2), [`| | **[Groceries](${url})** · 1 of 1 left |`, "|---|---|"]);
  assert.deepEqual(card({ title: "Wordle", card: { summary: "streak {/streak}" }, data: { streak: 3 } }, url), [`**[Wordle](${url})** · streak 3`]);
  assert.equal(card({ title: "A [b] | c", card: {}, data: {} }, url)[0], `**[A \\[b\\] \\| c](${url})**`, "brackets and bars in a title can't break the link");
});
