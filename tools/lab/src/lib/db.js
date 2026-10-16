// One SQLite file for every site, through Node's built-in node:sqlite. Every row carries its site,
// so the sites never see each other's users, as separate services wouldn't.

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const ROOT = path.resolve(import.meta.dirname, "../..");
const file = process.env.LAB_DB || path.join(ROOT, "data", "lab.db");
fs.mkdirSync(path.dirname(file), { recursive: true });

export const db = new DatabaseSync(file);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    site TEXT NOT NULL,
    email TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    pass TEXT,
    phone TEXT,
    totp TEXT,
    profile TEXT,
    created TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (site, email)
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    site TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{}',
    created TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS outbox (
    id INTEGER PRIMARY KEY,
    site TEXT NOT NULL,
    channel TEXT NOT NULL,
    recipient TEXT NOT NULL,
    code TEXT NOT NULL,
    purpose TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    created TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS pushes (
    id INTEGER PRIMARY KEY,
    site TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    number INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    made INTEGER NOT NULL DEFAULT 0,
    created TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS passkeys (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    public_key BLOB NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0,
    transports TEXT NOT NULL DEFAULT '[]',
    created TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

/** Empties every table: the lab as it was first started, before the sites seed again. */
export function wipe() {
  db.exec("DELETE FROM passkeys; DELETE FROM sessions; DELETE FROM outbox; DELETE FROM pushes; DELETE FROM users;");
}
