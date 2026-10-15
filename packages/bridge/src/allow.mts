// Which of AnythingLLM's internal routes a client may reach. The bridge logs in with AnythingLLM's
// password, so what it passes is the owner's to choose: BRIDGE_ALLOW lists the routes, and nothing
// else gets through.
//
// An entry is `[METHOD ]/path/prefix`, entries separated by commas:
//
//     GET /scheduled-jobs, /workspaces, POST /system/custom-models
//
// With no method an entry allows GET, POST, PUT and DELETE. A prefix matches whole path segments:
// `/workspaces` allows `/workspaces/home/memories` but not `/workspaces-old`. A `*` segment matches
// any one segment, for a route with the workspace in its middle: `POST /workspace/*/thread/*/update`.
// The path is AnythingLLM's own, under `/api`.

import { forbidden, invalid } from "./errors.mts";

export const METHODS = ["GET", "POST", "PUT", "DELETE"];
const WILDCARD = "*";
const SEGMENT = /^[^/\\\x00-\x1f\x7f]+$/;
const QUERY = /^[\x21-\x7e]*$/; // as it arrives, already percent-encoded

export interface Rule {
  /** null: any of METHODS. */
  method: string | null;
  prefix: string[];
}

/** The segments of a path with no empty, `.` or `..` segment, which could climb out of the prefix
 *  a rule names. */
function segmentsOf(path: string): string[] {
  const found = path.replace(/^\/+|\/+$/g, "").split("/");
  if (!found.every((s) => SEGMENT.test(s) && s !== "." && s !== "..")) throw invalid(`bad path ${JSON.stringify(path)}`);
  return found;
}

const pathOf = (segments: string[]): string => "/" + segments.join("/");

export const show = (rule: Rule): string => `${rule.method ? rule.method + " " : ""}${pathOf(rule.prefix)}`;

const matches = (prefix: string[], segments: string[]): boolean =>
  prefix.every((want, i) => i < segments.length && (want === WILDCARD || want === segments[i]));

const permits = (rule: Rule, method: string, segments: string[]): boolean =>
  (rule.method === null ? METHODS.includes(method) : rule.method === method) && matches(rule.prefix, segments);

/** Whether every request `other` permits is permitted by `rule` too. */
const covers = (rule: Rule, other: Rule): boolean => (rule.method === null || rule.method === other.method) && matches(rule.prefix, other.prefix);

/** The rules a BRIDGE_ALLOW text lists. */
export function parseRules(text: string): Rule[] {
  const rules: Rule[] = [];
  for (const entry of text.split(",").map((e) => e.trim()).filter(Boolean)) {
    const cut = entry.lastIndexOf(" ");
    const method = (cut < 0 ? "" : entry.slice(0, cut)).trim().toUpperCase();
    const path = entry.slice(cut + 1);
    if ((method && !METHODS.includes(method)) || !path.startsWith("/")) {
      throw invalid(`BRIDGE_ALLOW: ${JSON.stringify(entry)} is not \`[GET|POST|PUT|DELETE ]/path/prefix\``);
    }
    try {
      rules.push({ method: method || null, prefix: segmentsOf(path) });
    } catch {
      throw invalid(`BRIDGE_ALLOW: bad path in ${JSON.stringify(entry)}`);
    }
  }
  return rules;
}

/** The rules of `wanted` that nothing in `have` covers, as they are written. */
export const missingRules = (have: Rule[], wanted: Rule[]): string[] => wanted.filter((r) => !have.some((h) => covers(h, r))).map(show);

/** The chat routes of a default list: the rules that name a workspace, `/workspace/...`. */
export const chatRoutes = (defaultAllow: string): Rule[] => parseRules(defaultAllow).filter((r) => r.prefix[0] === "workspace" && r.prefix.length > 1);

/** Python's `quote(s, safe="")`, which JavaScript's encodeURIComponent differs from in `!'()*`. */
const quote = (s: string): string => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

/** The upstream path and query for a request the rules allow: each segment requoted, so an encoded
 *  `?` or `#` stays inside its segment. Throws 403 when no rule allows it, 400 for a bad query. */
export function route(rules: Rule[], method: string, path: string, query: string): string {
  const segments = segmentsOf(path);
  if (!rules.some((r) => permits(r, method, segments))) throw forbidden(`the bridge doesn't pass ${method} ${pathOf(segments)}`);
  if (!QUERY.test(query)) throw invalid("bad query string");
  return pathOf(segments.map(quote)) + (query ? `?${query}` : "");
}
