// Backup/restore verification pipeline (§9): isolated restore -> migrate ->
// replay finalized chain logs -> regenerate projections/snapshots -> compare
// roots -> promote ONLY after signed approval. Each step is independently
// injectable/mockable; promotion is refused unless the root comparison passes.

import { computeRoot, emptyRoot } from '@sih/protocol';
import { migrateUp } from '@sih/database/migrate';

/** Step 1: restore a backup artifact into an ISOLATED database. */
export async function isolatedRestore({ restore = async ({ artifact }) => ({ artifact }), artifact }) {
  return restore({ artifact });
}

/** Step 2: apply migrations to the restored database (forward-only runner). */
export async function migrateRestored(db) {
  return migrateUp(db);
}

/** Step 3: replay finalized chain logs from the deployment block. */
export async function replayFinalizedLogs(db, client, logs, { chainId = 31337, confirmationDepth = 0 } = {}) {
  const { storeRawLogs, deadLetterUnknown } = await import('../../indexer/ingest.js');
  const { projectEvents } = await import('../../indexer/project.js');
  const { finalizeUpTo } = await import('../../indexer/finalize.js');
  await storeRawLogs(db, logs);
  await deadLetterUnknown(db);
  const maxBlock = logs.reduce((m, l) => Math.max(m, l.blockNumber), 0);
  await projectEvents(db, client, maxBlock, { outbox: false });
  await finalizeUpTo(db, maxBlock, confirmationDepth);
  return { blocks: maxBlock, events: logs.length };
}

/** Step 4+5: regenerate leaf snapshots and compare recomputed roots to chain roots. */
export async function compareRoots(db, { expectedRoots }) {
  const failures = [];
  for (const { didHash, version, root } of expectedRoots) {
    const leaves = await db.collection('merkle_leaf_snapshots')
      .find({ did_hash: didHash, root_version: Number(version) }).sort({ ordinal: 1 }).toArray();
    const recomputed = leaves.length === 0 ? emptyRoot() : computeRoot(leaves.map((l) => ({ assetId: l.asset_id, leafHash: l.leaf_hash })));
    if (recomputed !== root) failures.push({ didHash, version, expected: root, recomputed });
  }
  return { ok: failures.length === 0, failures };
}

/** Step 6: promote the restored database — refused without a passing root comparison and signed approval. */
export async function promote({ comparison, signedApproval }) {
  if (!comparison?.ok) throw new Error('promotion refused: root comparison failed');
  if (!signedApproval) throw new Error('promotion refused: missing signed approval');
  return { promoted: true, at: new Date() };
}

/** Full pipeline. Every dependency is injectable for independent testing. */
export async function runRestorePipeline({
  artifact, restoredDb, client, logs, expectedRoots, signedApproval,
  restore, migrationRunner = migrateRestored, replayer = replayFinalizedLogs,
}) {
  await isolatedRestore({ restore, artifact });
  await migrationRunner(restoredDb);
  const replay = await replayer(restoredDb, client, logs);
  const comparison = await compareRoots(restoredDb, { expectedRoots });
  const promotion = comparison.ok ? await promote({ comparison, signedApproval }) : { promoted: false };
  return { replay, comparison, promotion };
}
