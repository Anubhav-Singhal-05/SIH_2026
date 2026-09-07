// Finalization: blocks/events are provisional until the environment's
// confirmation depth is reached, then marked final (DB-INDEX, DB-ACCEPT-003).
// Finalized flag cascades onto projections by event key.

/**
 * Mark blocks with head - block_number >= confirmationDepth as final, and
 * cascade `finalized: true` onto their events and every projection derived
 * from them. Returns the count of newly finalized blocks.
 */
export async function finalizeUpTo(db, headBlock, confirmationDepth) {
  const threshold = headBlock - confirmationDepth;
  const blocks = await db.collection('chain_blocks').find(
    { block_number: { $lte: threshold }, finalized: false, canonical: true },
  ).toArray();
  for (const b of blocks) {
    const session = db.client.startSession();
    try {
      await session.withTransaction(async () => {
        await db.collection('chain_blocks').updateOne({ _id: b._id }, { $set: { finalized: true } }, { session });
        const events = await db.collection('chain_events').find(
          { block_number: b.block_number, canonical: true }, { session },
        ).toArray();
        for (const ev of events) {
          const key = `${ev.chain_id}:${ev.block_number}:${ev.tx_hash}:${ev.log_index}`;
          await db.collection('chain_events').updateOne({ _id: ev._id }, { $set: { finalized: true } }, { session });
          await cascadeFinalized(db, key, session);
        }
      });
    } finally {
      await session.endSession();
    }
  }
  return blocks.length;
}

const PROJECTION_EVENT_KEY_COLLECTIONS = [
  ['identities', 'event_key'],
  ['assets', 'event_key'],
  ['asset_ownership_history', 'event_key'],
  ['document_versions', null], // matched via parent asset event — cascade by asset key below
  ['asset_permissions', 'event_key'],
  ['permission_history', 'event_key'],
  ['platform_roles', 'event_key'],
  ['merkle_root_versions', null],
  ['inheritance_rules', 'event_key'],
  ['inheritance_asset_rules', 'event_key'],
  ['inheritance_cases', null],
];

async function cascadeFinalized(db, key, session) {
  for (const [coll, field] of PROJECTION_EVENT_KEY_COLLECTIONS) {
    if (field) {
      await db.collection(coll).updateMany({ [field]: key, finalized: false }, { $set: { finalized: true } }, { session });
    }
  }
  // document_versions inherit finality from their parent asset's event
  const asset = await db.collection('assets').findOne({ event_key: key }, { session });
  if (asset) {
    await db.collection('document_versions').updateMany(
      { asset_id: asset.asset_id, finalized: false }, { $set: { finalized: true } }, { session },
    );
  }
  const root = await db.collection('merkle_root_versions').findOne({ tx_hash: key.split(':')[2], block_number: Number(key.split(':')[1]) }, { session });
  if (root) {
    await db.collection('merkle_root_versions').updateOne({ _id: root._id }, { $set: { finalized: true } }, { session });
  }
}
