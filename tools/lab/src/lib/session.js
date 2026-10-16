// Sessions kept in the database, by an id in a signed cookie. Every site names its cookie
// lab_<site>_sid: cookies ignore the port, so on localhost all the sites share one cookie jar.
// The cookie is Secure when the request came over https (through cloudflared, X-Forwarded-Proto).

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ROOT, db } from "./db.js";

const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function secret() {
  if (process.env.LAB_SECRET) return process.env.LAB_SECRET;
  const file = path.join(ROOT, "data", "secret");
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString("hex"), { mode: 0o600 });
  return fs.readFileSync(file, "utf8").trim();
}
const KEY = secret();

export const sign = (id) => `${id}.${crypto.createHmac("sha256", KEY).update(id).digest("base64url")}`;
export function unsign(value) {
  const at = String(value ?? "").lastIndexOf(".");
  if (at < 1) return null;
  const id = value.slice(0, at);
  const want = Buffer.from(sign(id));
  const got = Buffer.from(value);
  return want.length === got.length && crypto.timingSafeEqual(want, got) ? id : null;
}

export const newId = () => crypto.randomBytes(24).toString("base64url");

export function cookies(header) {
  const out = {};
  for (const part of String(header ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0) out[part.slice(0, at).trim()] = decodeURIComponent(part.slice(at + 1).trim());
  }
  return out;
}

const load = (site, id) => {
  const row = id && db.prepare("SELECT data FROM sessions WHERE id = ? AND site = ?").get(id, site);
  return row ? JSON.parse(row.data) : null;
};
const store = (site, id, data) =>
  db.prepare("INSERT INTO sessions (id, site, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data").run(id, site, JSON.stringify(data));
const drop = (id) => db.prepare("DELETE FROM sessions WHERE id = ?").run(id);

/** A token's session (the spa's bearer tokens are session ids too), or null. */
export const byToken = (site, token) => load(site, token);
/** Makes a session that only a token names; answers the token. */
export function issueToken(site, data) {
  const id = newId();
  store(site, id, data);
  return id;
}
export const revokeToken = drop;
/** Replaces what a token's session holds. */
export const updateToken = store;

/** Middleware giving req.session: { data, save(patch), signIn(userId), destroy() }. */
export function sessions(site) {
  const name = `lab_${site}_sid`;
  return (req, res, next) => {
    const given = unsign(cookies(req.headers.cookie)[name]);
    const found = load(site, given);
    let id = found ? given : null;
    const data = found ?? {};
    const setCookie = () => res.cookie(name, sign(id), { httpOnly: true, sameSite: "lax", secure: req.secure, path: "/", maxAge: MAX_AGE_MS });
    req.session = {
      data,
      save(patch = {}) {
        Object.assign(data, patch);
        if (!id) {
          id = newId();
          setCookie();
        }
        store(site, id, data);
      },
      /** A fresh session for `userId`, so an id from before signing in never carries the sign-in. */
      signIn(userId) {
        if (id) drop(id);
        for (const k of Object.keys(data)) delete data[k];
        id = null;
        this.save({ userId, signedIn: new Date().toISOString() });
      },
      destroy() {
        if (id) drop(id);
        id = null;
        for (const k of Object.keys(data)) delete data[k];
        res.clearCookie(name, { path: "/" });
      },
    };
    next();
  };
}
