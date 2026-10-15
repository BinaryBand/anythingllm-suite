// The facts' vectors, in AnythingLLM's own vector database and made by its own embedder, both as
// the server was set up (Settings, Embedder preference and Vector database): the skill brings no
// model and no store. Each scope has a namespace of its own, apart from every workspace's, and
// each fact is one document in it under an id this skill chooses, so it can be removed again.

import crypto from "crypto";
import path from "path";
import { GLOBAL, MemoryError, type Fact, type Scope } from "./facts";
import type { DocId, Embedder, Helpers, VectorDb, VectorsModel } from "./host";

/** AnythingLLM's server folder: MEMORY_LEAN_SERVER_DIR, else the folder it runs in. */
const serverDir = (): string => process.env.MEMORY_LEAN_SERVER_DIR || process.cwd();

const namespaceOf = (scope: Scope): string => (scope === GLOBAL ? "memory-lean-g" : `memory-lean-w-${scope}`);

/** A fact's vector document, like m12-3: its id and how many times its text has been written.
 *  AnythingLLM knows it as the document id `memory-lean:m12-3`, and each hit brings back the
 *  address `memory-lean://m12-3`. */
export const docOf = (fact: Fact): string => `m${fact.id}-${fact.rev}`;
const DOC_ID = "memory-lean:";
const ADDRESS = "memory-lean://";

/** What the vectors were made with. AnythingLLM drops only the workspaces' namespaces when this
 *  changes, so a scope whose vectors were made with something else is made again from the index. */
export const fingerprint = (): string =>
  [process.env.EMBEDDING_ENGINE, process.env.EMBEDDING_MODEL_PREF, process.env.EMBEDDING_BASE_PATH, process.env.VECTOR_DB].map((v) => v || "").join("|");

/** One of AnythingLLM's own modules, by its path under the server folder. */
function load<T>(what: string): T {
  try {
    return require(path.join(serverDir(), what)) as T;
  } catch (e) {
    throw new MemoryError(`AnythingLLM's ${what} couldn't be loaded from ${serverDir()}: ${(e as Error).message}`);
  }
}

/** What AnythingLLM made for `what` from its helpers, or a MemoryError saying why not. */
function setUp<T>(what: string, make: (helpers: Helpers) => T): T {
  const helpers = load<Helpers>("utils/helpers");
  try {
    return make(helpers);
  } catch (e) {
    throw new MemoryError(`AnythingLLM's ${what} couldn't be set up: ${(e as Error).message}`);
  }
}

/** AnythingLLM's record of which vectors a document made. LanceDB leaves it behind when it
 *  deletes the vectors (the other databases clear it), so it is cleared here, after. */
async function forgetRecords(clause: { docId: DocId }): Promise<void> {
  try {
    await load<VectorsModel>("models/vectors").DocumentVectors.delete(clause);
  } catch {
    // The record only lets AnythingLLM find vectors to remove; a stale one harms nothing.
  }
}

/** One per call: it builds AnythingLLM's database client and embedder when first used. */
export class Vectors {
  #db: VectorDb | null = null;
  #connector: Embedder | null = null;

  get db(): VectorDb {
    return (this.#db ||= setUp("vector database", (h) => h.getVectorDbClass()));
  }

  /** The embedder, as the connector a similarity search wants. A search of each of a call's
   *  scopes asks it for the same query, which it embeds once. */
  get connector(): Embedder {
    if (!this.#connector) {
      const embedder = setUp("embedder", (h) => h.getEmbeddingEngineSelection());
      const seen = new Map<string, unknown>();
      this.#connector = {
        embedTextInput(text: string): unknown {
          if (!seen.has(text)) seen.set(text, embedder.embedTextInput(text));
          return seen.get(text);
        },
      };
    }
    return this.#connector;
  }

  /** Embeds the fact and keeps it in its scope's namespace. */
  async add(fact: Fact): Promise<void> {
    const result = await this.db.addDocumentToNamespace(
      namespaceOf(fact.scope),
      {
        docId: DOC_ID + docOf(fact),
        id: crypto.randomUUID(),
        url: ADDRESS + docOf(fact),
        title: "memory",
        docAuthor: "@agent",
        description: "Unknown",
        docSource: "a fact the user asked the agent to remember.",
        chunkSource: "",
        published: "",
        wordCount: fact.text.split(" ").length,
        pageContent: fact.text,
        token_count_estimate: 0,
      },
      null,
    );
    if (!result || result.error || result.vectorized === false) {
      throw new MemoryError(`the fact couldn't be embedded (${result?.error || "no reason was given"}); is the server's embedder reachable?`);
    }
  }

  /** Takes the fact's vectors out of its namespace, and AnythingLLM's record of them. */
  async remove(fact: Fact): Promise<void> {
    const docId = DOC_ID + docOf(fact);
    await this.db.deleteDocumentFromNamespace(namespaceOf(fact.scope), docId);
    await forgetRecords({ docId });
  }

  /** The `k` documents of the scope closest to `query`: `{doc, score}`, closest first, or null
   *  when the namespace isn't there. */
  async nearest(scope: Scope, query: string, k: number): Promise<{ doc: string; score: number }[] | null> {
    const found = await this.db.performSimilaritySearch({
      namespace: namespaceOf(scope),
      input: query,
      LLMConnector: this.connector,
      similarityThreshold: 0,
      topN: k,
    });
    if (found.message) return null;
    const best = new Map<string, number>();
    for (const source of found.sources || []) {
      const url = String(source.url || "");
      if (!url.startsWith(ADDRESS)) continue;
      const doc = url.slice(ADDRESS.length);
      const score = Number.isFinite(Number(source.score)) ? Number(source.score) : 0;
      best.set(doc, Math.max(best.get(doc) ?? score, score));
    }
    return [...best].map(([doc, score]) => ({ doc, score })).sort((a, b) => b.score - a.score);
  }

  /** Drops the scope's namespace, if there is one, and the records of the facts it held. */
  async drop(scope: Scope, facts: Fact[]): Promise<void> {
    try {
      await this.db["delete-namespace"]({ namespace: namespaceOf(scope) });
    } catch (e) {
      if (e instanceof MemoryError) throw e; // not "it wasn't there"
    }
    if (facts.length) await forgetRecords({ docId: { in: facts.map((x) => DOC_ID + docOf(x)) } });
  }
}
