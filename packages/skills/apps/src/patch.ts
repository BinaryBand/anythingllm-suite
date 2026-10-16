// JSON Patch (RFC 6902) and JSON Pointer (RFC 6901) on plain JSON values. apply() never changes its
// input: it answers the patched copy, or throws a PatchError naming the operation that failed.

/** A JSON value as the skill handles it: data, schemas and app files, read from JSON and checked by
 *  the schema at run time rather than by types. */
export type Json = any;

export class PatchError extends Error {}

export const clone = <T,>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)));

/** The pointer's reference tokens: "" is the whole document. */
function tokens(pointer: string): string[] {
  if (pointer === "") return [];
  if (typeof pointer !== "string" || !pointer.startsWith("/")) throw new PatchError(`not a JSON pointer: ${JSON.stringify(pointer)}`);
  return pointer.slice(1).split("/").map((t) => t.replace(/~1/g, "/").replace(/~0/g, "~"));
}

const isIndex = (token: string): boolean => /^(0|[1-9][0-9]*)$/.test(token);

/** The value the pointer names, or undefined when there is none. */
export function get(doc: Json, pointer: string): Json {
  let here = doc;
  for (const t of tokens(pointer)) {
    if (Array.isArray(here)) {
      if (!isIndex(t) || Number(t) >= here.length) return undefined;
      here = here[Number(t)];
    } else if (here !== null && typeof here === "object") {
      if (!Object.hasOwn(here, t)) return undefined;
      here = here[t];
    } else return undefined;
  }
  return here;
}

export function equal(a: Json, b: Json): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => equal(x, b[i]));
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && equal(a[k], b[k]));
}

/** The container the pointer's last token is in, and that token; throws when there is none. */
function parentOf(doc: Json, pointer: string, op: string): { parent: Json; last: string } {
  const last = tokens(pointer).pop()!;
  const parent = get(doc, pointer.slice(0, pointer.lastIndexOf("/")));
  if (parent === null || typeof parent !== "object") throw new PatchError(`${op} ${pointer}: no such place`);
  return { parent, last };
}

function add(doc: Json, pointer: string, value: Json): Json {
  if (pointer === "") return value;
  const { parent, last } = parentOf(doc, pointer, "add");
  if (Array.isArray(parent)) {
    if (last === "-") parent.push(value);
    else if (isIndex(last) && Number(last) <= parent.length) parent.splice(Number(last), 0, value);
    else throw new PatchError(`add ${pointer}: no such place in the list`);
  } else parent[last] = value;
  return doc;
}

/** Takes the value the pointer names out of `doc`, in place, and answers it. */
function remove(doc: Json, pointer: string): Json {
  if (pointer === "") throw new PatchError("remove: can't remove the whole document");
  const { parent, last } = parentOf(doc, pointer, "remove");
  if (Array.isArray(parent)) {
    if (!isIndex(last) || Number(last) >= parent.length) throw new PatchError(`remove ${pointer}: no such item`);
    return parent.splice(Number(last), 1)[0];
  }
  if (!Object.hasOwn(parent, last)) throw new PatchError(`remove ${pointer}: no such key`);
  const value = parent[last];
  delete parent[last];
  return value;
}

/** `doc` with `patch` applied, as a new value. */
export function apply(doc: Json, patch: Json): Json {
  if (!Array.isArray(patch)) throw new PatchError("a patch is a list of operations");
  let out = clone(doc);
  patch.forEach((o: Json, i: number) => {
    const where = `operation ${i + 1}`;
    if (!o || typeof o !== "object" || typeof o.path !== "string") throw new PatchError(`${where}: needs op and path`);
    switch (o.op) {
      case "add":
        if (!("value" in o)) throw new PatchError(`${where}: add needs a value`);
        out = add(out, o.path, clone(o.value));
        break;
      case "remove":
        remove(out, o.path);
        break;
      case "replace":
        if (!("value" in o)) throw new PatchError(`${where}: replace needs a value`);
        if (get(out, o.path) === undefined) throw new PatchError(`replace ${o.path}: nothing there`);
        if (o.path === "") out = clone(o.value);
        else {
          remove(out, o.path);
          out = add(out, o.path, clone(o.value));
        }
        break;
      case "move":
        if (o.path.startsWith(o.from + "/")) throw new PatchError(`move ${o.from}: into itself`);
        out = add(out, o.path, remove(out, o.from));
        break;
      case "copy": {
        const value = get(out, o.from);
        if (value === undefined) throw new PatchError(`copy ${o.from}: nothing there`);
        out = add(out, o.path, clone(value));
        break;
      }
      case "test":
        if (!equal(get(out, o.path), o.value)) throw new PatchError(`test ${o.path} failed: it holds ${JSON.stringify(get(out, o.path))}`);
        break;
      default:
        throw new PatchError(`${where}: unknown op ${JSON.stringify(o.op)}`);
    }
  });
  return out;
}
