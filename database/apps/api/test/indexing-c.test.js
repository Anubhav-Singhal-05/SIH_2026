// DB-INDEX-012..014, DB-ACCEPT-003/004 — finality, outbox, reorg.

import test from 'node:test';
import assert from 'node:assert/strict';
import { withEphemeralDb, makeProvider, ev, OWNER, NEW_OWNER, H } from './harness.js';
import { runOnce } from '../src/indexer/index.js';
import { detectReorg, handleReorg } from '../src/indexer/reorg.js';
import { loadManifest } from '../src/chain/manifest.js';
import { AssetRepository } from '../src/infrastructure/repositories/index.js';
import { publishOutbox } from '../src/indexer/project.js';

const MANIFEST = loadManifest();

test('DB-INDEX-012: provisional until confirmation depth — never final early (DB-ACCEPT-003)', async () => {
  await withEphemeralDb(async (db, client) => {
    const p = makeProvider([ev.assetRegistered(10, '50')], { blocks: Array.from({ length: 20 }, (_, i) => i + 1) });
    await runOnce(db, client, [p], { manifest: MANIFEST }); // head=20, depth=12 -> blocks <= 8 final
    const asset = await db.collection('assets').findOne({ asset_id: '50' });
    assert.equal(asset.finalized, false); // block 10 > 20-12
    // repositories never expose provisional rows
    assert.equal(await new AssetRepository(db).getFinalizedAsset('50'), null);
    const p2 = makeProvider([ev.assetRegistered(10, '50')], { blocks: Array.from({ length: 40 }, (_, i) => i + 1) });
    await runOnce(db, client, [p2], { manifest: MANIFEST }); // head=40 -> block 10 final
    const asset2 = await db.collection('assets').findOne({ asset_id: '50' });
    assert.equal(asset2.finalized, true);
    assert.ok(await new AssetRepository(db).getFinalizedAsset('50'));
  });
});

test('DB-INDEX-013: outbox notification fires only after commit', async () => {
  await withEphemeralDb(async (db, client) => {
    const p = makeProvider([ev.assetRegistered(2, '60')], { blocks: [1, 2] });
    await runOnce(db, client, [p], { manifest: MANIFEST });
    // the notifier publishes only AFTER the projection transaction commits:
    // every published outbox row must have a matching projected block marker.
    const rows = await db.collection('event_outbox').find({}).toArray();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].published, true);
    const marker = await db.collection('indexer_state').findOne({ _id: `progress:block:${rows[0].block_number}` });
    assert.ok(marker); // projection committed before the outbox row was published
    const { publishOutbox } = await import('../src/indexer/project.js');
    const published = [];
    await publishOutbox(db, async (row) => published.push(row.event_key));
    assert.equal(published.length, 0); // already published post-commit; never re-fired
  });
});

test('DB-INDEX-014: reorg — ancestor located, non-final marked, projections rebuilt, orphaned kept (DB-ACCEPT-004)', async () => {
  await withEphemeralDb(async (db, client) => {
    const p = makeProvider([ev.assetRegistered(3, '70')], { blocks: [1, 2, 3, 4, 5] });
    await runOnce(db, client, [p], { manifest: MANIFEST });
    assert.equal((await db.collection('assets').findOne({ asset_id: '70' })).owner_did_hash, OWNER);

    // fork: block 3 replaced with a different event chain
    const forkHash = H(0xf0);
    const forkParent = (await db.collection('chain_blocks').findOne({ block_number: 3 })).parent_hash;
    const ancestor = await detectReorg(db, MANIFEST.chainId, { blockNumber: 4, parentHash: forkParent });
    assert.ok(ancestor !== null && ancestor <= 3);

    const replacement = [{
      chainId: MANIFEST.chainId, blockNumber: 3, blockHash: forkHash, parentHash: forkParent,
      timestamp: 1_700_000_100, txHash: H(0xff), txIndex: 0, logIndex: 0, contract: 'AssetRegistry', abiVersion: '1',
      name: 'AssetRegistered', payload: { assetId: '70', ownerDidHash: NEW_OWNER, documentHash: H(0x55), metadataHash: H(0x66), storageCommitment: H(0x77), version: 1 },
    }];
    await handleReorg(db, client, MANIFEST.chainId, ancestor, replacement);

    // projections rebuilt to the canonical fork state
    const asset = await db.collection('assets').findOne({ asset_id: '70', canonical: { $ne: false } });
    assert.equal(asset.owner_did_hash, NEW_OWNER);
    // orphaned history retained with a non-canonical flag — never deleted
    const orphans = await db.collection('chain_blocks').find({ canonical: false }).toArray();
    assert.ok(orphans.length >= 1);
    const staleEvents = await db.collection('chain_events').find({ canonical: false }).toArray();
    assert.ok(staleEvents.length >= 1);
    assert.ok(staleEvents[0].non_canonical_reason.includes('reorg'));
  });
});
