// Root reconciliation — implements the §6 root-update failure policy plus
// periodic integrity checks (worker entry point: workers/reconciler).

import { computeRoot, emptyRoot, normalizeHex32 } from '@sih/protocol';
import { MerkleService } from '../../modules/merkle/service.js';

/**
 * Reconcile a single (did, rootVersion). Outcomes:
 *  - OK
 *  - DRIFT: projection root != contract root -> block intent + alert
 *  - NEEDS_REFRESH: root stale at execution time -> recompute from final state
 *  - P1: asset event finalized but matching root event never arrived
 *  - QUARANTINE: root event finalized without expected asset event
 */
export async function reconcileRoot(db, merkle, didHash, rootVersion) {
  return merkle.reconcileRoot(didHash, rootVersion);
}

/**
 * Quarantine the operation and reconcile chain state (policy branch 4).
 */
export async function quarantineOperation(db, merkle, operationId, detail) {
  await db.collection('operations').updateOne(
    { id: operationId, status: { $in: ['PENDING', 'SUBMITTED'] } },
    { $set: { status: 'QUARANTINED', quarantine_detail: detail, quarantined_at: new Date() } },
  );
  await db.collection('indexer_alerts').insertOne({ level: 'quarantine', operationId, detail, at: new Date() });
}

/** Recompute every stored root snapshot and verify it matches its finalized root event. */
export async function verifyAllSnapshots(db, { limit = 1000 } = {}) {
  const roots = await db.collection('merkle_root_versions').find({ finalized: true }).limit(limit).toArray();
  const failures = [];
  const merkle = new MerkleService(db);
  for (const root of roots) {
    const leaves = await merkle.leaves(root.did_hash, root.version);
    const recomputed = leaves.length === 0 ? emptyRoot() : computeRoot(leaves);
    if (recomputed !== root.root) {
      failures.push({ did_hash: root.did_hash, version: root.version, stored: root.root, recomputed });
    }
  }
  if (failures.length) {
    await db.collection('indexer_alerts').insertOne({
      level: 'drift', type: 'snapshot_recompute_mismatch', failures, at: new Date(),
    });
  }
  return { checked: roots.length, failures };
}

/**
 * Detect P1 atomicity violations: a finalized asset lifecycle event for a DID
 * with no corresponding finalized root event at/after it.
 */
export async function scanAtomicityViolations(db) {
  const assetEvents = await db.collection('chain_events').find({
    name: { $in: ['AssetRegistered', 'AssetTransferred', 'AssetDeactivated', 'DocumentVersionUpdated'] },
    finalized: true,
    canonical: true,
  }).toArray();
  const violations = [];
  for (const ev of assetEvents) {
    const didHash = normalizeHex32(ev.payload?.ownerDidHash ?? ev.payload?.toDidHash ?? ev.payload?.fromDidHash);
    if (!didHash || didHash === normalizeHex32('0x' + '00'.repeat(32))) continue;
    const hasRoot = await db.collection('merkle_root_versions').countDocuments({
      did_hash: didHash,
      block_number: { $gte: ev.block_number },
      finalized: true,
    });
    if (!hasRoot) violations.push({ event_key: `${ev.chain_id}:${ev.block_number}:${ev.tx_hash}:${ev.log_index}`, did_hash: didHash, block: ev.block_number });
  }
  for (const v of violations) {
    await db.collection('indexer_alerts').insertOne({ level: 'P1', type: 'missing_root_event', ...v, at: new Date() });
  }
  return violations;
}
