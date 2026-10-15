// A skill's static files (guides, pages, snippets: what is tuned rather than coded) as it ships them
// (build.mjs inlines its static/ folder) or as the user tuned them on this instance: a file at the
// same path under the override folder (<storage>/<hubId>/static/) wins, so a guide can be polished
// on the live AnythingLLM without a rebuild, and a reinstall doesn't undo it. Read at each call, so a
// change takes effect on the next one.

import fs from "node:fs";
import path from "node:path";

export interface StaticFile {
  text: string;
  /** Where the user's own version is, when it's theirs rather than the shipped one. */
  tuned: string | null;
}

export interface StaticFiles {
  /** The file, or null when there's none. */
  get(name: string): StaticFile | null;
  /** The files under `prefix` ("guide/"), shipped or added, by their names there, sorted. */
  list(prefix: string): string[];
}

/** Only plain relative paths: no "..", no absolute path, nothing hidden. */
const safe = (name: string): boolean => /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/i.test(name) && !name.split("/").includes("..");

export function staticFiles(shipped: Record<string, string>, overrideDir: string): StaticFiles {
  return {
    get(name) {
      if (!safe(name)) return null;
      const own = path.join(overrideDir, name);
      try {
        return { text: fs.readFileSync(own, "utf8"), tuned: own };
      } catch {
        return Object.hasOwn(shipped, name) ? { text: shipped[name], tuned: null } : null;
      }
    },
    list(prefix) {
      const names = new Set(Object.keys(shipped).filter((name) => name.startsWith(prefix)).map((name) => name.slice(prefix.length)));
      try {
        for (const entry of fs.readdirSync(path.join(overrideDir, prefix), { withFileTypes: true })) if (entry.isFile() && safe(entry.name)) names.add(entry.name);
      } catch {}
      return [...names].filter((name) => !name.includes("/")).sort();
    },
  };
}
