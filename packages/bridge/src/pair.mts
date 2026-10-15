// What a phone connects with. AnywhereLLM Lite takes a link holding AnythingLLM's address and a
// developer key, and the bridge's and anythingllm-apps-v2's addresses when they are known:
// `anywherellm://connect?url=...&key=...&toolkit=...&apps=...`. The link's `toolkit` field keeps its
// name: it is what the app reads. Plain http is allowed only to a private host.

import net from "node:net";
import { invalid, upstream as upstreamError } from "./errors.mts";
import { expect, type Upstream } from "./upstream.mts";

const KEY_NAME = "AnywhereLLM";

const PRIVATE = new net.BlockList();
for (const [address, bits] of [["127.0.0.0", 8], ["10.0.0.0", 8], ["172.16.0.0", 12], ["192.168.0.0", 16], ["169.254.0.0", 16], ["100.64.0.0", 10]] as const) {
  PRIVATE.addSubnet(address, bits, "ipv4"); // 100.64/10 is Tailscale's (CGNAT)
}
for (const [address, bits] of [["::1", 128], ["fc00::", 7], ["fe80::", 10]] as const) PRIVATE.addSubnet(address, bits, "ipv6");

const PRIVATE_SUFFIXES = [".local", ".lan", ".home.arpa", ".ts.net"];

/** True for localhost, a name with no dot (a LAN host such as `nas`), a name ending in .local, .lan,
 *  .home.arpa or .ts.net, and an address in a loopback, private, link-local or Tailscale range. */
export function privateHost(host: string): boolean {
  const name = host.trim().replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (!name) return false;
  const bare = name.split("%", 1)[0]; // an IPv6 zone is not the address
  const kind = net.isIP(bare);
  if (kind) return PRIVATE.check(bare, kind === 6 ? "ipv6" : "ipv4");
  return name === "localhost" || !name.includes(".") || PRIVATE_SUFFIXES.some((s) => name.endsWith(s));
}

/** `url` without surrounding whitespace or a trailing slash, when the phone may send its key
 *  there: https anywhere, or http to a private host. */
export function phoneUrl(url: string): string {
  const clean = url.trim().replace(/\/+$/, "");
  try {
    const { protocol, hostname } = new URL(clean);
    if (protocol === "https:" || (protocol === "http:" && privateHost(hostname))) return clean;
  } catch {
    // not an address: refused below
  }
  throw invalid(
    `the phone sends its key over https, or over http only on a private network (home, Tailscale or this device): not ${JSON.stringify(clean)}`,
  );
}

/** The text a phone connects with: AnythingLLM's address, the key, and the bridge's and the apps
 *  server's addresses when given, each checked by `phoneUrl`. */
export function pairingLink(url: string, key: string, bridge?: string | null, apps?: string | null): string {
  const fields = new URLSearchParams({ url: phoneUrl(url), key });
  if (bridge) fields.set("toolkit", phoneUrl(bridge));
  if (apps) fields.set("apps", phoneUrl(apps));
  return "anywherellm://connect?" + fields.toString();
}

interface Key {
  name?: string;
  secret?: string;
}

/** The secret of the developer key called `name`, made when there is none. Every phone shares
 *  KEY_NAME's, so deleting it in AnythingLLM's settings disconnects them all. */
export async function developerKey(api: Upstream, name: string = KEY_NAME): Promise<string> {
  const listed = (expect(await api.exchange("GET", "/system/api-keys")) as { apiKeys?: Key[] } | null)?.apiKeys ?? [];
  const found = listed.find((k) => k?.name === name && k.secret)?.secret;
  if (found) return found;
  const made = expect(await api.exchange("POST", "/system/generate-api-key", { name })) as { apiKey?: Key; error?: string } | null;
  if (!made?.apiKey?.secret) throw upstreamError(`AnythingLLM made no key${made?.error ? `: ${made.error}` : ""}`);
  return made.apiKey.secret;
}
