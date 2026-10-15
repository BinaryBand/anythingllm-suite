import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { writeAtomic } from "./atomic.mts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "skills-shared-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));
const dir = () => fs.mkdtempSync(path.join(root, "t-"));

test("writes the data and makes the folder", () => {
  const file = path.join(dir(), "a", "b", "f.json");
  writeAtomic(file, '{"x":1}');
  assert.equal(fs.readFileSync(file, "utf8"), '{"x":1}');
});

test("replaces an existing file whole and leaves no temp file", () => {
  const root = dir();
  const file = path.join(root, "f.json");
  writeAtomic(file, "first, and longer");
  writeAtomic(file, "second");
  assert.equal(fs.readFileSync(file, "utf8"), "second");
  assert.deepEqual(fs.readdirSync(root), ["f.json"]);
});

test("applies the mode", { skip: process.platform === "win32" }, () => {
  const file = path.join(dir(), "secret");
  writeAtomic(file, "k", 0o600);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test("a failed write throws, keeps what was there and leaves no temp file", () => {
  const root = dir();
  const target = path.join(root, "f");
  fs.mkdirSync(target); // a folder where the file should go: the rename cannot succeed
  assert.throws(() => writeAtomic(target, "x"));
  assert.deepEqual(fs.readdirSync(root), ["f"]);
});
