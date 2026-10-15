// Follows a "next" cursor until it has `input.limit` items or the API has no more pages.
// Adapt: the path, the cursor's name in the query and in the answer, and where the items are.
async function main(input, kit) {
  const limit = Math.min(input.limit || 100, 500);
  const items = [];
  let cursor = null;
  while (items.length < limit) {
    const answer = await kit.http({ path: "/items", params: { limit: 100, ...(cursor ? { cursor } : {}) } });
    if (!answer.ok) throw new Error(`the API answered ${answer.status}`);
    items.push(...answer.body.data);
    cursor = answer.body.next_cursor;
    if (!cursor) break;
  }
  return { count: items.length, items: items.slice(0, limit).map((item) => ({ id: item.id, name: item.name })) };
}
