// The codes the sites "send" by email or SMS. Nothing leaves the machine: they land here, and the
// dashboard shows them, as the user's inbox or phone would.

import crypto from "node:crypto";
import { db } from "./db.js";

const VALID_MINUTES = 10;

/** Sends a 6-digit code to `recipient` by `channel` ("email" or "sms"); answers it. */
export function send(site, channel, recipient, purpose) {
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  db.prepare("INSERT INTO outbox (site, channel, recipient, code, purpose) VALUES (?, ?, ?, ?, ?)").run(site, channel, recipient, code, purpose);
  return code;
}

/** Whether `code` is the latest unused one sent to `recipient` for `purpose`, still valid; it's used up if so. */
export function redeem(site, recipient, purpose, code) {
  const row = db
    .prepare(`SELECT id, code FROM outbox WHERE site = ? AND recipient = ? AND purpose = ? AND used = 0 AND created >= datetime('now', '-${VALID_MINUTES} minutes') ORDER BY id DESC LIMIT 1`)
    .get(site, recipient, purpose);
  if (!row || row.code !== String(code ?? "").trim()) return false;
  db.prepare("UPDATE outbox SET used = 1 WHERE id = ?").run(row.id);
  return true;
}

export const recent = ({ site, recipient, limit = 50 } = {}) =>
  db
    .prepare(`SELECT * FROM outbox WHERE (? IS NULL OR site = ?) AND (? IS NULL OR recipient = ?) ORDER BY id DESC LIMIT ?`)
    .all(site ?? null, site ?? null, recipient ?? null, recipient ?? null, limit);

/** "a•••@lab.test" or "•••• 0100", as a site shows where it sent a code. */
export const masked = (channel, recipient) =>
  channel === "sms" ? `•••• ${recipient.slice(-4)}` : recipient.replace(/^(.)[^@]*/, "$1•••");
