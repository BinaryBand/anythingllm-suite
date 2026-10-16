import { OFFSETS, portOf, publicUrlOf } from "./ports.js";

// The address a visitor used, which behind cloudflared isn't localhost: express (trust proxy) reads
// X-Forwarded-Proto, and the host comes from X-Forwarded-Host or Host. WebAuthn checks both.

export const hostOf = (req) => String(req.get("x-forwarded-host") || req.get("host") || "localhost").split(",")[0].trim();
export const originOf = (req) => `${req.protocol}://${hostOf(req)}`;
/** The passkey relying party: the host name without its port. */
export const rpIdOf = (req) => hostOf(req).replace(/:\d+$/, "").replace(/^\[|\]$/g, "");

/** Where a visitor reaches another site: its public address when there is one, else this host on that site's port. */
export function siblingOrigin(req, name) {
  const site = { name, offset: OFFSETS[name] };
  return publicUrlOf(site) ?? `${req.protocol}://${hostOf(req).replace(/:\d+$/, "")}:${portOf(site)}`;
}
