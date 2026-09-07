// Typed repository layer — no raw queries leak into feature modules (§7).
// Every list/detail response attaches projection finalization metadata and the
// last indexed block, so the backend can decide whether a direct chain read is
// required for high-risk prechecks.

/**
 * @typedef {Object} FinalizationMeta
 * @property {boolean} finalized
 * @property {number|null} lastIndexedBlock
 * @property {boolean} chainReadRecommended
 */

/** Shared helpers for repositories. */
export function meta(doc, lastIndexedBlock) {
  const finalized = doc?.finalized === true;
  return {
    finalized,
    lastIndexedBlock: lastIndexedBlock ?? null,
    chainReadRecommended: !finalized, // provisional -> direct chain read wins for prechecks
  };
}

export async function getLastIndexedBlock(db, chainId = 31337) {
  const doc = await db.collection('indexer_state').findOne({ _id: `progress:${chainId}` });
  return doc?.lastIngestedBlock ?? doc?.lastProjectedBlock ?? null;
}

/** Cursor pagination over an ascending sort key; stable under concurrent inserts. */
export async function paginateCursor(coll, filter, { cursor, limit = 50, sortField = 'asset_id', direction = 1, projection }) {
  const f = { ...filter };
  if (cursor) {
    f[sortField] = direction === 1 ? { $gt: cursor } : { $lt: cursor };
  }
  const docs = await coll.find(f, { projection })
    .sort({ [sortField]: direction })
    .limit(limit + 1)
    .toArray();
  const hasMore = docs.length > limit;
  const page = hasMore ? docs.slice(0, limit) : docs;
  const nextCursor = hasMore ? String(page[page.length - 1][sortField]) : null;
  return { items: page, nextCursor, hasMore };
}
