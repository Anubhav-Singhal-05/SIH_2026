// Backup/recovery/performance suite (§9) — DB-BACKUP-003/004 and replay.

import test from 'node:test';
import assert from 'node:assert/strict';
import { withEphemeralDb, makeProvider, ev, OWNER, NEW_OWNER, H, leaf as leafOf } from './harness.js';
import { runOnce } from '../src/indexer/index.js';
import { loadManifest } from '../src/chain/manifest.js';
import { isolatedRestore, migrateRestored, replayFinalizedLogs, compareRoots, promote } from '../src/workers/backup/replay.js';
import { MerkleService } from '../src/modules/merkle/service.js';
import { computeRoot, normalizeHex32 } from '@sih/protocol';

const MANIFEST = loadManifest();

test('DB-BACKUP-003/004: restore -> migrate -> replay -> compare roots -> promote only on success+approval', async () => {
  await withEphemeralDb(async (db, client) => {
    // build a finalized chain: asset registered, root updated, snapshot persisted
    const p = makeProvider([ev.assetRegistered(3, '10'), ev.merkleRootUpdated(4, OWNER, 1, H(0xc1))], { blocks: Array.from({ length: 20 }, (_, i) => i + 1) });
    await runOnce(db, client, [p], { manifest: MANIFEST });
    const leaf = leafOf('10');
    await new MerkleService(db).persistSnapshot(OWNER, 1, [{ assetId: '10', leafHash: leaf, ordinal: 0 }]);

    // each step independently testable/mockable
    let restored = false;
    const restoredDb = db; // in the test the "isolated restore" IS this ephemeral db
    await isolatedRestore({ artifact: 'backup-2026-09-07.archive', restore: async ({ artifact }) => { restored = true; assert.ok(artifact.includes('backup')); return { artifact }; } });
    assert.ok(restored);
    await migrateRestored(restoredDb); // idempotent on a migrated DB
    const replay = await replayFinalizedLogs(restoredDb, client, await p.getLogs(1, 8));

    // compare recomputed roots against the chain's expected roots
    const expectedRoots = [{ didHash: normalizeHex32(OWNER), version: 1, root: H(0xc1) }];
    const badComparison = await compareRoots(restoredDb, { expectedRoots });
    // snapshot root is the recomputed tree from leaves; the seeded root event H(0xc1) is the "chain" value.
    // With a mismatch, promotion is REFUSED:
    await assert.rejects(() => promote({ comparison: badComparison, signedApproval: true }), /root comparison failed/);
    // without signed approval, even a good comparison refuses:
    const goodComparison = await compareRoots(restoredDb, {
      expectedRoots: [{ didHash: normalizeHex32(OWNER), version: 1, root: computeRoot([{ assetId: '10', leafHash: leaf }]) }],
    });
    assert.equal(goodComparison.ok, true);
    await assert.rejects(() => promote({ comparison: goodComparison, signedApproval: false }), /signed approval/);
    // success + approval -> promote
    const promoted = await promote({ comparison: goodComparison, signedApproval: 'officer-signature' });
    assert.equal(promoted.promoted, true);
    // full pipeline refuses promotion when comparison fails
    const pipeline = await import('../src/workers/backup/replay.js');
    const out = await pipeline.runRestorePipeline({
      artifact: 'backup-x', restoredDb, client, logs: await p.getLogs(1, 8),
      expectedRoots: [{ didHash: normalizeHex32(OWNER), version: 1, root: H(0xc1) }], // deliberately wrong
      signedApproval: 'officer-signature',
    });
    assert.equal(out.promotion.promoted, false);
  });
});
