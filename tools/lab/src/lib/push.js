// Sign-in approvals, as a phone app would answer them: the site makes a request with a 2-digit
// number, shows the number on the page, and waits. The person (or a test, through the dashboard) says
// yes by giving that number; anything else is a no, and an unanswered request times out.

import crypto from "node:crypto";
import { db } from "./db.js";

const ttl = () => Math.max(1, Number(process.env.LAB_PUSH_TTL) || 60);
const expire = () => db.prepare("UPDATE pushes SET status = 'expired' WHERE status = 'pending' AND made < ?").run(Date.now() - ttl() * 1000);

/** A pending request for `userId` on `site`: { id, number }. */
export function create(site, userId) {
  expire();
  const taken = new Set(db.prepare("SELECT number FROM pushes WHERE status = 'pending'").all().map((r) => r.number));
  let number;
  do number = crypto.randomInt(10, 100);
  while (taken.has(number) && taken.size < 90);
  const { lastInsertRowid } = db.prepare("INSERT INTO pushes (site, user_id, number, made) VALUES (?, ?, ?, ?)").run(site, userId, number, Date.now());
  return { id: Number(lastInsertRowid), number };
}

/** "pending", "approved", "denied", "expired" or "used", or null for no such request. */
export function status(id) {
  expire();
  return db.prepare("SELECT status FROM pushes WHERE id = ?").get(id)?.status ?? null;
}

const answer = (number, to) => {
  expire();
  const row = db.prepare("SELECT id FROM pushes WHERE status = 'pending' AND number = ? ORDER BY id DESC LIMIT 1").get(Number(number));
  if (!row) return false;
  db.prepare("UPDATE pushes SET status = ? WHERE id = ?").run(to, row.id);
  return true;
};
export const approve = (number) => answer(number, "approved");
export const deny = (number) => answer(number, "denied");

/** Uses up an approval, once: true the first time, false after. */
export const consume = (id) => db.prepare("UPDATE pushes SET status = 'used' WHERE id = ? AND status = 'approved'").run(id).changes === 1;

/** Requests still waiting, newest first, with who they're for. */
export function pending() {
  expire();
  return db
    .prepare("SELECT p.id, p.site, p.number, p.created, u.email FROM pushes p JOIN users u ON u.id = p.user_id WHERE p.status = 'pending' ORDER BY p.id DESC")
    .all();
}
