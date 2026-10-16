import crypto from "node:crypto";

/** "salt:hash", both hex, with scrypt. */
export function hash(password) {
  const salt = crypto.randomBytes(16);
  return `${salt.toString("hex")}:${crypto.scryptSync(password, salt, 32).toString("hex")}`;
}

export function verify(password, stored) {
  if (!stored || !password) return false;
  const [salt, want] = stored.split(":");
  const got = crypto.scryptSync(String(password), Buffer.from(salt, "hex"), 32);
  return crypto.timingSafeEqual(got, Buffer.from(want, "hex"));
}
