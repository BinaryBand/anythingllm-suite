// What an app does to sign people in through Lumen ID (sites/idp.js): the address to send the browser to,
// and, once it comes back with a code, the server-to-server swap for who that was.

import { originOf, siblingOrigin } from "./origin.js";
import { OFFSETS, portOf } from "./ports.js";

const backChannel = () => `http://127.0.0.1:${portOf({ offset: OFFSETS.idp })}`;

/** Where to send the browser; the app's callback is /auth/callback. `fragment` asks for the code after a #. */
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
export async function exchange(req, { clientId, secret, code }) {
  const token = await fetch(`${backChannel()}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code: String(code ?? ""), redirect_uri: `${originOf(req)}/auth/callback`, client_id: clientId, client_secret: secret }),
  });
  if (!token.ok) return null;
  const info = await fetch(`${backChannel()}/userinfo`, { headers: { authorization: `Bearer ${(await token.json()).access_token}` } });
  return info.ok ? info.json() : null;
}
