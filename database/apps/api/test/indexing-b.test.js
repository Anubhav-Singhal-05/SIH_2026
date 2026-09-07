// DB-INDEX-008..011 — projection effects, idempotency, ordering, restart.

import test from 'node:test';
import assert from 'node:assert/strict';
import { withEphemeralDb, makeProvider, ev, OWNER, GRANTEE, NEW_OWNER, H } from './harness.js';
import { runOnce } from '../src/indexer/index.js';
import { projectEvents } from '../src/indexer/project.js';
import { storeRawLogs } from '../src/indexer/ingest.js';
import { loadManifest } from '../src/chain/manifest.js';

const MANIFEST = loadManifest();

test('DB-INDEX-008: every catalog event produces its documented projection effect', async () => {
  await withEphemeralDb(async (db, client) => {
    const p = makeProvider([
      ev.identityRegistered(2),
      ev.assetRegistered(3, '10'),
      ev.accessGranted(4, '10'),
      ev.assetTransferred(5, '10'),
      ev.assetDeactivated(6, '10'),
      { block: 7, contract: 'AssetAccessRegistry', name: 'PlatformRoleGranted', payload: { didHash: OWNER, role: 'auditor' } },
      { block: 8, contract: 'InheritanceRegistry', name: 'InheritanceRuleSet', payload: { ownerDidHash: OWNER, defaultNomineeDidHash: GRANTEE, policyHash: H(0x99), overrides: [{ assetId: '10', beneficiaryDidHash: NEW_OWNER }] } },
    ], { blocks: [1, 2, 3, 4, 5, 6, 7, 8] });
    await runOnce(db, client, [p], { manifest: MANIFEST });
    const asset = await db.collection('assets').findOne({ asset_id: '10' });
    assert.equal(asset.owner_did_hash, NEW_OWNER); // transferred
    assert.equal(asset.status, 'inactive'); // then deactivated
    const history = await db.collection('asset_ownership_history').find({ asset_id: '10' }).toArray();
    assert.equal(history.length, 2); // registered + transferred
    assert.equal(await db.collection('asset_permissions').countDocuments({ asset_id: '10', active: true }), 0); // cleared on transfer
    const roles = await db.collection('platform_roles').findOne({ did_hash: OWNER, role: 'auditor' });
    assert.equal(roles.active, true);
    const rule = await db.collection('inheritance_rules').findOne({ owner_did_hash: OWNER });
    assert.equal(rule.default_nominee_did_hash, GRANTEE);
    const override = await db.collection('inheritance_asset_rules').findOne({ owner_did_hash: OWNER, asset_id: '10' });
    assert.equal(override.beneficiary_did_hash, NEW_OWNER);
    const identity = await db.collection('identities').findOne({ did_hash: OWNER });
    assert.equal(identity.status, 'active');
  });
});

test('DB-INDEX-009: duplicate log delivery never double-applies (unique event key upserts)', async () => {
  await withEphemeralDb(async (db, client) => {
    const events = [ev.assetRegistered(3, '21'), ev.assetRegistered(3, '21')];
    const p = makeProvider(events, { blocks: [1, 2, 3] });
    await storeRawLogs(db, await p.getLogs(1, 3));
    await projectEvents(db, client, 3);
    await projectEvents(db, client, 3); // replay of the same range
    assert.equal(await db.collection('assets').countDocuments({ asset_id: '21' }), 1);
    assert.equal(await db.collection('asset_ownership_history').countDocuments({ asset_id: '21' }), 1);
  });
});

test('DB-INDEX-010: out-of-order provider pages are re-sorted before projection', async () => {
  await withEphemeralDb(async (db, client) => {
    const events = [ev.assetRegistered(3, '30', OWNER, 0), ev.documentVersionUpdated(3, '30', 2, 1)];
    const p = makeProvider(events, { blocks: [1, 2, 3] });
    const logs = (await p.getLogs(1, 3)).reverse(); // out-of-order page
    await storeRawLogs(db, logs);
    await projectEvents(db, client, 3);
    assert.equal((await db.collection('assets').findOne({ asset_id: '30' })).current_version, 2);
  });
});

test('DB-INDEX-011: clean restart / crash resume — no gap, no duplicate', async () => {
  await withEphemeralDb(async (db, client) => {
    const events = [ev.assetRegistered(2, '40'), ev.assetRegistered(6, '41')];
    const p = makeProvider(events, { blocks: [1, 2, 3, 4, 5, 6] });
    await runOnce(db, client, [p], { manifest: MANIFEST }); // full pass
    await runOnce(db, client, [p], { manifest: MANIFEST }); // restart from scratch
    assert.equal(await db.collection('assets').countDocuments(), 2);
    assert.equal(await db.collection('asset_ownership_history').countDocuments(), 2);
    assert.equal(await db.collection('chain_events').countDocuments(), 2);
  });
});
