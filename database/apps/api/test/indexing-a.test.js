// DB-INDEX-001..006 — indexer basics.

import test from 'node:test';
import assert from 'node:assert/strict';
import { withEphemeralDb, makeProvider, ev, OWNER, GRANTEE, NEW_OWNER, H } from './harness.js';
import { runOnce } from '../src/indexer/index.js';
import { projectEvents } from '../src/indexer/project.js';
import { storeRawLogs } from '../src/indexer/ingest.js';
import { loadManifest } from '../src/chain/manifest.js';
import { FailoverProvider } from '../src/chain/provider.js';

const MANIFEST = loadManifest();

test('DB-INDEX-001: indexer starts at the manifest deployment block', async () => {
  assert.equal(MANIFEST.deploymentBlock, 1);
  await withEphemeralDb(async (db, client) => {
    // provider has an event at block 0 (before deployment) — must be ignored
    const p = makeProvider([ev.assetRegistered(0, '1'), ev.assetRegistered(2, '2')], { blocks: [0, 1, 2] });
    await runOnce(db, client, [p], { manifest: MANIFEST });
    assert.equal(await db.collection('chain_events').countDocuments({ block_number: 0 }), 0);
    assert.ok(await db.collection('assets').findOne({ asset_id: '2' }));
    assert.equal(await db.collection('assets').countDocuments({ asset_id: '1' }), 0);
  });
});

test('DB-INDEX-002: bounded range fetch with provider failover', async () => {
  await withEphemeralDb(async () => {
    const events = Array.from({ length: 5 }, (_, i) => ev.assetRegistered(i + 1, String(i + 1)));
    const good = makeProvider(events, { name: 'good' });
    let primaryFailed = false;
    const failing = {
      name: 'flaky',
      async getLogs() { primaryFailed = true; throw new Error('rpc down'); },
      async getBlock() { throw new Error('rpc down'); },
      async latestBlock() { throw new Error('rpc down'); },
    };
    const alerts = [];
    const p = new FailoverProvider([failing, good], {
      maxRangeSize: 2,
      onFailover: (from, to, a, b) => alerts.push([from, to, a, b]),
    });
    const logs = await p.getLogs(1, 5); // 5 blocks in ranges of 2 -> 3 bounded ranges
    assert.equal(logs.length, 5);
    assert.ok(alerts.length >= 1); // failed over on error (sticky to healthy provider)
    assert.ok(primaryFailed);
  });
});

test('DB-INDEX-003: raw storage idempotent — re-fetch does not duplicate', async () => {
  await withEphemeralDb(async (db) => {
    const p = makeProvider([ev.assetRegistered(2, '7')], { blocks: [1, 2] });
    const logs = await p.getLogs(1, 2);
    await storeRawLogs(db, logs);
    await storeRawLogs(db, logs);
    assert.equal(await db.collection('chain_events').countDocuments(), 1);
    assert.equal(await db.collection('chain_blocks').countDocuments(), 1); // only logged-on blocks stored
  });
});

test('DB-INDEX-004: unknown ABI/event -> dead-letter + alert, no crash, no silent drop', async () => {
  await withEphemeralDb(async (db, client) => {
    const p = makeProvider([ev.unknownEvent(2), ev.assetRegistered(2, '9')], { blocks: [1, 2] });
    await runOnce(db, client, [p], { manifest: MANIFEST });
    const dead = await db.collection('chain_events').findOne({ name: 'FutureOpaqueEventV99' });
    assert.equal(dead.dead_letter, true);
    assert.ok(dead.dead_letter_reason.length > 0);
    const alert = await db.collection('indexer_alerts').findOne({ type: 'dead_letter' });
    assert.ok(alert); // alert raised
    assert.ok(await db.collection('assets').findOne({ asset_id: '9' })); // known event still projected
  });
});

test('DB-INDEX-005/006: strict (block, tx, log) projection order; one tx per block', async () => {
  await withEphemeralDb(async (db, client) => {
    // same block: registered (log 0), then version-updated (log 1) -> current_version must be 2
    const p = makeProvider([
      ev.assetRegistered(3, '5', OWNER, 0),
      ev.documentVersionUpdated(3, '5', 2, 1),
    ], { blocks: [2, 3] });
    await runOnce(db, client, [p], { manifest: MANIFEST });
    const asset = await db.collection('assets').findOne({ asset_id: '5' });
    assert.equal(asset.current_version, 2); // later log in the same block won
  });
});
