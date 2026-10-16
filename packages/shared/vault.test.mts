import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { VaultError, load, newId, openSealed, publicKey, update } from "./vault.mts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vault-"));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
let dir = "";
let n = 0;
beforeEach(() => {
  dir = path.join(tmp, `v${n++}`);
  process.env.SIG_KEY = "sig-key";
  process.env.SIG_SALT = "sig-salt";
});

const entry = (user: string) => ({ id: newId(), kind: "key", site: "api.example.com", user, value: `secret-${user}` });

test("an entry kept is there to load, and the file holds it encrypted", async () => {
  assert.deepEqual(load(dir), { pub: null, priv: null, entries: [] }, "no file is an empty vault");
  const id = await update((v) => {
    const e = entry("work");
    v.entries.push(e);
    return e.id;
  }, dir);
  assert.equal(load(dir).entries[0].id, id);
  assert.equal(load(dir).entries[0].value, "secret-work");
  const text = fs.readFileSync(path.join(dir, "vault.json"), "utf8");
  assert.ok(!text.includes("secret-work"), "the value isn't in the file in clear");
  assert.equal(JSON.parse(text).v, 1);
  if (process.platform !== "win32") assert.equal((fs.statSync(path.join(dir, "vault.json")).mode & 0o777).toString(8), "600"); // Windows has no modes
});

test("what's changed in a loaded copy isn't kept, and a change that throws writes nothing", async () => {
  await update((v) => void v.entries.push(entry("a")), dir);
  load(dir).entries.push(entry("b"));
  assert.equal(load(dir).entries.length, 1);
  await assert.rejects(
    update((v) => {
      v.entries.push(entry("c"));
      throw new Error("changed my mind");
    }, dir),
    /changed my mind/,
  );
  assert.equal(load(dir).entries.length, 1);
  await update((v) => void v.entries.push(entry("d")), dir);
  assert.equal(load(dir).entries.length, 2, "a failed change doesn't stop the next");
});

test("a vault saved under another SIG_KEY can't be opened, and says why", async () => {
  await update((v) => void v.entries.push(entry("a")), dir);
  process.env.SIG_KEY = "another";
  assert.throws(() => load(dir), (e: Error) => e instanceof VaultError && /SIG_KEY or SIG_SALT changed/.test(e.message));
});

test("without SIG_KEY and SIG_SALT, a random key is kept beside the vault", async () => {
  delete process.env.SIG_KEY;
  delete process.env.SIG_SALT;
  await update((v) => void v.entries.push(entry("a")), dir);
  const key = fs.readFileSync(path.join(dir, "vault.key"), "utf8");
  assert.equal(Buffer.from(key.trim(), "base64").length, 32);
  assert.equal(load(dir).entries.length, 1);
});

test("changes from one process all land, in turn", async () => {
  await Promise.all(Array.from({ length: 20 }, (_, i) => update((v) => void v.entries.push(entry(`p${i}`)), dir)));
  assert.equal(load(dir).entries.length, 20);
});

test("changes from two processes at once all land: the lock folder takes them in turn", async () => {
  const module = pathToFileURL(fileURLToPath(new URL("./vault.mts", import.meta.url))).href;
  const child = `
    const v = await import(${JSON.stringify(module)});
    const dir = process.argv[1], who = process.argv[2];
    await Promise.all(Array.from({ length: 25 }, (_, i) => v.update((x) => { x.entries.push({ id: v.newId(), kind: "key", site: "s.example", user: who + i }); }, dir)));
  `;
  const env = { ...process.env, SIG_KEY: "sig-key", SIG_SALT: "sig-salt" };
  const run = (who: string) => promisify(execFile)(process.execPath, ["--input-type=module", "-e", child, dir, who], { env });
  await Promise.all([run("a"), run("b")]);
  const users = load(dir).entries.map((e) => e.user);
  assert.equal(users.length, 50, "no change was lost");
  assert.equal(new Set(users).size, 50);
  assert.ok(!fs.existsSync(path.join(dir, "vault.lock")), "the lock was released");
});

test("a lock a dead process left behind is broken once it's old", async () => {
  fs.mkdirSync(path.join(dir, "vault.lock"), { recursive: true });
  const old = new Date(Date.now() - 120 * 1000);
  fs.utimesSync(path.join(dir, "vault.lock"), old, old);
  await update((v) => void v.entries.push(entry("a")), dir);
  assert.equal(load(dir).entries.length, 1);
});

test("what a page seals with the public key opens here, short (RSA) or long (h1.)", async () => {
  const pub = await publicKey(dir);
  assert.equal(await publicKey(dir), pub, "the pair is made once");
  const key = crypto.createPublicKey({ key: Buffer.from(pub, "base64"), format: "der", type: "spki" });
  const rsa = (data: Buffer) => crypto.publicEncrypt({ key, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, data).toString("base64");
  assert.equal(openSealed(rsa(Buffer.from("hunter2")), dir), "hunter2");
  const long = "x".repeat(2000);
  const aes = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", aes, iv);
  const box = Buffer.concat([cipher.update(long, "utf8"), cipher.final(), cipher.getAuthTag()]);
  assert.equal(openSealed(`h1.${rsa(aes)}.${iv.toString("base64")}.${box.toString("base64")}`, dir), long);
  assert.throws(() => openSealed("not sealed", dir), /couldn't be opened/);
});
