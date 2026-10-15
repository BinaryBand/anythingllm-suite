// What AnythingLLM supplies to the skill, as far as the skill uses it. AnythingLLM's server code is
// not a public API (see the README's Limits), so these are the skill's own description of it.

interface Source {
  url?: string;
  score?: number | string;
}

interface SearchResult {
  sources?: Source[];
  /** Set, instead of sources, when the namespace is not there. */
  message?: string | false;
}

interface AddResult {
  vectorized?: boolean;
  error?: string | null;
}

export interface Embedder {
  embedTextInput(text: string): unknown;
}

export interface VectorDb {
  addDocumentToNamespace(namespace: string, document: Record<string, unknown>, fullFilePath: string | null): Promise<AddResult | undefined>;
  deleteDocumentFromNamespace(namespace: string, docId: string): Promise<unknown>;
  performSimilaritySearch(args: { namespace: string; input: string; LLMConnector: Embedder; similarityThreshold: number; topN: number }): Promise<SearchResult>;
  "delete-namespace"(args: { namespace: string }): Promise<unknown>;
}

/** AnythingLLM's `utils/helpers`. */
export interface Helpers {
  getVectorDbClass(): VectorDb;
  getEmbeddingEngineSelection(): Embedder;
}

/** One document id, or several, as AnythingLLM's records are deleted by. */
export type DocId = string | { in: string[] };

/** AnythingLLM's `models/vectors`. */
export interface VectorsModel {
  DocumentVectors: { delete(clause: { docId: DocId }): Promise<unknown> };
}

/** `this` in the handler, as AnythingLLM's agent sets it up. */
export interface HandlerContext {
  super?: { handlerProps?: { invocation?: { workspace?: { slug?: string } } } };
  logger?: (message: string) => void;
}
