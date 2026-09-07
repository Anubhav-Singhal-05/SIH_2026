// Reorg handling (DB-INDEX reorg test, DB-ACCEPT-004).
//
// On parent-hash mismatch: locate the common ancestor via parent hashes,
// mark later blocks/events non-canonical (NEVER deleted — kept for forensic
// audit with a non_canonical flag), flag the stale projections they produced
// as non-canonical, then replay the canonical logs to rebuild correct state.
// Finalized (deep) rows are never overwritten in place: they are flagged and
// superseded by the replayed canonical rows; provisional rows may be
// delete-and-replayed freely (DB-SCHEMA-025).

import { projectEvents } from './project.js';
import { storeRawLogs, deadLetterUnknown } from './ingest.js';

/**
 * Detect a reorg at `newBlock` ({blockNumber, parentHash}).
 * Returns the common ancestor block number, or null if there is no fork.
 */
export async function detectReorg(db, chainId, { blockNumber, parentHash }) {
  let stored = await db.collection('chain_blocks').findOne({ chain_id: chainId, block_number: blockNumber - 1 });
  if (!stored) return null; // parent unseen: gap, not a reorg
  if (stored.block_hash === parentHash) return null; // consistent
  let probe = blockNumber - 1;
  let incomingParent = stored.parent_hash;
  for (let i = 0; i < 10_000 && probe >= 0; i++) {
    const candidate = await db.collection('chain_blocks').findOne({ chain_id: chainId, block_number: probe });
    if (!candidate) return probe; // missing history: treat as fork point
    if (candidate.block_hash === incomingParent) return probe; // common ancestor
    incomingParent = candidate.parent_hash;
    probe -= 1;
  }
  throw new Error('reorg deeper than 10000 blocks: manual intervention required');
}

/**
 * Resolve a detected reorg at common ancestor A:
 *  1. mark all stored blocks/events above A non-canonical (kept, flagged);
 *  2. flag finalized stale projections non-canonical and delete provisional
 *     ones (delete-and-replay allowed for provisional rows);
 *  3. store + replay the canonical replacement events to rebuild state.
 * Orphaned history is retained with a non-canonical flag — never deleted.
 */
export async function handleReorg(db, client, chainId, ancestorBlock, replacementLogs) {
  const session = client.startSession();
  const affected = new Set();
  const ancestor = ancestorBlock;
  try {
    await session.withTransaction(async () => {
      const orphaned = await db.collection('chain_blocks').find(
        { chain_id: chainId, block_number: { $gt: ancestor }, canonical: true }, { session },
      ).toArray();
      for (const b of orphaned) {
        await db.collection('chain_blocks').updateOne(
          { _id: b._id },
          { $set: { canonical: false, non_canonical_reason: `reorg: superseded at ancestor ${ancestor}` } },
          { session },
        );
        const evs = await db.collection('chain_events').find(
          { chain_id: chainId, block_number: b.block_number, canonical: true }, { session },
        ).toArray();
        for (const ev of evs) {
          collectAffected(affected, ev);
          await db.collection('chain_events').updateOne(
            { _id: ev._id },
            { $set: { canonical: false, non_canonical_reason: `reorg: superseded at ancestor ${ancestor}` } },
            { session },
          );
        }
      }
      // reverse/rebuild affected projections
      for (const item of affected) {
        const { coll, doc } = JSON.parse(item);
        // provisional rows: delete-and-replay
        await db.collection(coll).deleteMany({ ...doc, finalized: false }, { session });
        // finalized stale rows: never overwritten in place — flag non-canonical
        await db.collection(coll).updateMany(
          { ...doc, finalized: true },
          { $set: { canonical: false, non_canonical_reason: `reorg: reversed at ancestor ${ancestor}` } },
          { session },
        );
      }
    });
  } finally {
    await session.endSession();
  }
  await storeRawLogs(db, replacementLogs);
  await deadLetterUnknown(db);
  const maxBlock = replacementLogs.reduce((m, l) => Math.max(m, l.blockNumber), 0);
  await projectEvents(db, client, maxBlock, { outbox: true });
  return { ancestorBlock: ancestor, affectedKeys: affected.size };
}

function collectAffected(affected, ev) {
  const p = ev.payload ?? {};
  const evKey = `${ev.chain_id}:${ev.block_number}:${ev.tx_hash}:${ev.log_index}`;
  const push = (coll, doc) => affected.add(JSON.stringify({ coll, doc }));
  const s = (x) => String(x);
  switch (ev.name) {
    case 'IdentityRegistered': case 'IdentityControllerRotated': case 'IdentityStatusChanged':
      push('identities', { did_hash: p.didHash });
      break;
    case 'AssetRegistered': case 'DocumentVersionUpdated': case 'AssetTransferred': case 'AssetDeactivated':
      push('assets', { asset_id: s(p.assetId) });
      push('asset_ownership_history', { event_key: evKey });
      if (ev.name === 'AssetRegistered') push('document_versions', { asset_id: s(p.assetId) });
      break;
    case 'PlatformRoleGranted': case 'PlatformRoleRevoked':
      push('platform_roles', { did_hash: p.didHash, role: p.role });
      break;
    case 'AccessGranted':
      push('asset_permissions', { asset_id: s(p.assetId), grantee_did_hash: p.granteeDidHash });
      push('permission_history', { event_key: evKey });
      break;
    case 'AccessRevoked':
      push('permission_history', { event_key: evKey });
      break;
    case 'MerkleRootUpdated':
      push('merkle_root_versions', { did_hash: p.didHash, version: Number(p.version) });
      break;
    case 'InheritanceRuleSet':
      push('inheritance_rules', { owner_did_hash: p.ownerDidHash });
      break;
    case 'InheritanceActivated': case 'InheritanceBatchExecuted': case 'InheritanceClosed':
      push('inheritance_cases', { owner_did_hash: p.ownerDidHash });
      break;
    default:
      break;
  }
}
