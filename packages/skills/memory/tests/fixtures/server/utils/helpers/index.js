// Stands in for AnythingLLM's utils/helpers in the tests (ANYTHINGLLM_SERVER_DIR points here): a
// vector database in memory with the methods of AnythingLLM's own (add and delete a document,
// similarity search, delete a namespace), and an embedder that hashes a text's words into a
// vector, so texts that share words are close. `fake` is the state a test looks at and changes,
// and `reset` empties it; models/vectors.js shares it.

const fake = { tables: new Map(), docVectors: [], embeds: 0, down: false };

function reset() {
  fake.tables = new Map();
  fake.docVectors = [];
  fake.embeds = 0;
  fake.down = false;
}

const DIMS = 64;
function embed(text) {
  if (fake.down) throw new Error("the embedder is down");
  fake.embeds += 1;
  const v = new Array(DIMS).fill(0);
  for (const word of String(text).toLowerCase().match(/[a-z0-9]{2,}/g) || []) {
    let h = 2166136261;
    for (const c of word) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
    v[h % DIMS] += 1;
  }
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}

const embedder = { embedTextInput: async (text) => embed(text) };

const db = {
  async addDocumentToNamespace(namespace, { docId, pageContent, ...metadata }) {
    try {
      const rows = fake.tables.get(namespace) || [];
      const id = `${docId}#${rows.length}-${Math.random().toString(36).slice(2)}`;
      rows.push({ id, docId, vector: embed(pageContent), text: pageContent, ...metadata });
      fake.tables.set(namespace, rows);
      fake.docVectors.push({ id: fake.docVectors.length + 1, docId, vectorId: id });
      return { vectorized: true, error: null };
    } catch (e) {
      return { vectorized: false, error: e.message };
    }
  },
  async deleteDocumentFromNamespace(namespace, docId) {
    const rows = fake.tables.get(namespace);
    if (!rows) return;
    fake.tables.set(namespace, rows.filter((r) => r.docId !== docId));
    return true;
  },
  async performSimilaritySearch({ namespace, input, LLMConnector, similarityThreshold = 0.25, topN = 4 }) {
    if (!namespace || !input || !LLMConnector) throw new Error("Invalid request to performSimilaritySearch.");
    if (!fake.tables.has(namespace)) return { contextTexts: [], sources: [], message: "Invalid query - no documents found for workspace!" };
    const q = await LLMConnector.embedTextInput(input);
    const sources = fake.tables
      .get(namespace)
      .map((r) => ({ ...r, score: r.vector.reduce((sum, x, i) => sum + x * q[i], 0) }))
      .filter((r) => r.score >= similarityThreshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, topN)
      .map(({ vector, docId, ...rest }) => rest);
    return { contextTexts: sources.map((s) => s.text), sources, message: false };
  },
  async "delete-namespace"({ namespace }) {
    if (!fake.tables.has(namespace)) throw new Error("Namespace by that name does not exist.");
    fake.tables.delete(namespace);
    return { message: `Namespace ${namespace} was deleted.` };
  },
};

module.exports = {
  getVectorDbClass: () => db,
  getEmbeddingEngineSelection: () => embedder,
  fake,
  reset,
};
