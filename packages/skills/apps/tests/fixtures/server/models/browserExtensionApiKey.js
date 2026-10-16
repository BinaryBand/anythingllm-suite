// Stands in for AnythingLLM's models/browserExtensionApiKey in the tests (ANYTHINGLLM_SERVER_DIR
// points here): a key it made is valid until it's revoked (deleted from `made`).
const made = (globalThis.__appsLeanKeys ||= new Set());
let n = 0;

module.exports = {
  BrowserExtensionApiKey: {
    validate: async (key) => made.has(key),
    create: async () => {
      const key = `brx-test-${++n}`;
      made.add(key);
      return { apiKey: { key }, error: null };
    },
  },
  made,
};
