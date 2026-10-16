// What an app does to sign people in through Lumen ID (sites/idp.js): the address to send the browser to,
// and, once it comes back with a code, the checks and the server-to-server swap for who that was.

import crypto from "node:crypto";
import { originOf, siblingOrigin } from "./origin.js";
import { OFFSETS, portOf } from "./ports.js";

/** The apps Lumen ID serves. Each one's callback is /auth/callback on its own site. */
export const CLIENTS = {
  "cirrus-docs": { name: "Cirrus Docs", secret: "cirrus-secret", site: "federated" },
  murmur: { name: "Murmur Chat", secret: "murmur-secret", site: "murmur" },
};

const backChannel = () => `http://127.0.0.1:${portOf({ offset: OFFSETS.idp })}`;
export const newState = () => crypto.randomBytes(16).toString("base64url");

/** Where to send the browser. `fragment` asks for the answer after a # instead of in the query. */
export function authorizeUrl(req, { clientId, state, fragment = false }) {
  const to = new URL(`${siblingOrigin(req, "idp")}/authorize`);
  to.searchParams.set("client_id", clientId);
  to.searchParams.set("response_type", "code");
  to.searchParams.set("redirect_uri", `${originOf(req)}/auth/callback`);
  to.searchParams.set("state", state);
  if (fragment) to.searchParams.set("response_mode", "fragment");
  return to.toString();
}

/** Who `code` is for ({ email, name }), or null when Lumen ID won't say. Throws when it can't be reached. */
async function exchange(req, { clientId, code }) {
  const token = await fetch(`${backChannel()}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code: String(code ?? ""), redirect_uri: `${originOf(req)}/auth/callback`, client_id: clientId, client_secret: CLIENTS[clientId].secret }),
  });
  if (!token.ok) return null;
  const info = await fetch(`${backChannel()}/userinfo`, { headers: { authorization: `Bearer ${(await token.json()).access_token}` } });
  return info.ok ? info.json() : null;
}

/** What a callback does with the answer: { info } for who signed in, or { ok: false, problem, status }.
 *  `expected` is the state saved when the sign-in began. */
export async function completeSignIn(req, { clientId, expected, state, code, error }) {
  if (!expected || !state || state !== expected) return { ok: false, problem: "That sign-in has expired. Start again.", status: 400 };
  if (error) return { ok: false, problem: "Lumen ID sign-in was cancelled.", status: 400 };
  try {
    const info = await exchange(req, { clientId, code });
    return info ? { info } : { ok: false, problem: "Lumen ID didn't accept that sign-in.", status: 400 };
  } catch {
    return { ok: false, problem: "Couldn't reach Lumen ID.", status: 502 };
  }
}
