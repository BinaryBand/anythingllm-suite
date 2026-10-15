// Stands in for AnythingLLM's models/vectors: the record of which vectors a document made.
const { fake } = require("../utils/helpers");

const DocumentVectors = {
  /** Deletes the records of `clause.docId`, one document id or `{ in: [ids] }`. */
  async delete(clause = {}) {
    const ids = clause.docId?.in || [clause.docId];
    fake.docVectors = fake.docVectors.filter((r) => !ids.includes(r.docId));
    return true;
  },
};

module.exports = { DocumentVectors };
