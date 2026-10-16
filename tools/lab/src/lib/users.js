import { db } from "./db.js";
import * as passwords from "./passwords.js";

/** The user every site starts with. */
export const ALICE = { email: "alice@lab.test", name: "Alice Example", pass: "Alice-pass-1" };

export const byId = (id) => db.prepare("SELECT * FROM users WHERE id = ?").get(id) ?? null;
export const byEmail = (site, email) => db.prepare("SELECT * FROM users WHERE site = ? AND email = ?").get(site, normal(email)) ?? null;
export const byPhone = (site, phone) => db.prepare("SELECT * FROM users WHERE site = ? AND phone = ?").get(site, normalPhone(phone)) ?? null;
export const ofSite = (site) => db.prepare("SELECT id, email, name, phone, created FROM users WHERE site = ? ORDER BY id").all(site);

export const normal = (email) => String(email ?? "").trim().toLowerCase();
export const normalPhone = (phone) => String(phone ?? "").replace(/[^\d+]/g, "");
export const validEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normal(email));

/** A new user; `pass` is hashed here. Answers the user, or throws when the email is taken. */
export function create(site, { email, name = "", pass = null, passHash = null, phone = null, totp = null, profile = null }) {
  const { lastInsertRowid } = db
    .prepare("INSERT INTO users (site, email, name, pass, phone, totp, profile) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(site, normal(email), String(name).trim(), pass ? passwords.hash(pass) : passHash, phone ? normalPhone(phone) : null, totp, profile ? JSON.stringify(profile) : null);
  return byId(lastInsertRowid);
}

export const update = (id, fields) => {
  const keys = Object.keys(fields);
  db.prepare(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...keys.map((k) => fields[k]), id);
};

export const remove = (id) => db.prepare("DELETE FROM users WHERE id = ?").run(id);

/** The user with this email and password on `site`, or null. */
export function check(site, email, pass) {
  const user = byEmail(site, email);
  return user && passwords.verify(pass, user.pass) ? user : null;
}

/** Adds Alice (and `extra` for her) to `site` unless she's there. */
export function seed(site, extra = {}) {
  if (!byEmail(site, ALICE.email)) create(site, { ...ALICE, ...extra });
}

/** Why a sign-up can't go ahead, or null. */
export function signupProblem(site, { email, pass, confirm }) {
  if (!validEmail(email)) return "Enter a valid email address.";
  if (byEmail(site, email)) return "An account with that email already exists.";
  if (pass !== undefined && String(pass).length < 8) return "Use at least 8 characters for your password.";
  if (confirm !== undefined && pass !== confirm) return "The passwords don't match.";
  return null;
}
