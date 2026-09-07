// DB-SCHEMA-012..018 â€” asset/storage/merkle constraints.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createEphemeralDb } from '../src/test-util.js';
import { fixture, H1, H2, MAX_UINT128, MAX_UINT256 } from '../fixtures/fixtures.js';
import { uuidv7 } from '../src/uuid7.js';

const state = {};
test.before(async () => {
  const eph = await createEphemeralDb();
  state.db = eph.db; state.cleanup = eph.cleanup;
});
test.after(async (t) => { await state.cleanup(); });

test('DB-SCHEMA-012: assets.asset_id unique, numeric(78,0)-equivalent, no precision loss', async (t) => {
  const { db } = state;
  const c = db.collection('assets');
  await c.insertOne(fixture.asset(MAX_UINT128));
  const doc = await c.findOne({ asset_id: MAX_UINT128 });
  assert.equal(doc.asset_id, MAX_UINT128); // exact round-trip
  await c.insertOne(fixture.asset(MAX_UINT256, { owner_did_hash: H2, event_key: 'ev:zmax' }));
  assert.equal((await c.findOne({ asset_id: MAX_UINT256 })).asset_id, MAX_UINT256);
  await assert.rejects(() => c.insertOne(fixture.asset(MAX_UINT128, { event_key: 'other' })), /duplicate|E11000/i);
  // validator rejects non-decimal / overflowing values
  await assert.rejects(() => c.insertOne(fixture.asset('1' + '0'.repeat(79))), /validation/i);
  await assert.rejects(() => c.insertOne(fixture.asset('12.5')), /validation/i);
});

test('DB-SCHEMA-013: asset_ownership_history unique event key', async (t) => {
  const { db } = state;
  const c = db.collection('asset_ownership_history');
  await c.insertOne(fixture.ownership('5'));
  await assert.rejects(() => c.insertOne(fixture.ownership('5', { id: uuidv7() })), /duplicate|E11000/i);
});

test('DB-SCHEMA-014: document_versions unique (asset_id, version)', async (t) => {
  const { db } = state;
  const c = db.collection('document_versions');
  await c.insertOne(fixture.documentVersion('7', 1));
  await assert.rejects(() => c.insertOne(fixture.documentVersion('7', 1, { id: uuidv7() })), /duplicate|E11000/i);
  await c.insertOne(fixture.documentVersion('7', 2, { id: uuidv7() }));
  await c.insertOne(fixture.documentVersion('8', 1, { id: uuidv7() }));
});

test('DB-SCHEMA-015/016: unique active (asset,grantee); revoke->new-active tolerated', async (t) => {
  const { db } = state;
  const c = db.collection('asset_permissions');
  await c.insertOne(fixture.permission('9'));
  await assert.rejects(() => c.insertOne(fixture.permission('9', H2, { event_key: 'ev:x' })), /duplicate|E11000/i);
  // revoke -> immediate new active grant: no false violation
  await c.updateOne({ asset_id: '9', grantee_did_hash: H2 }, { $set: { active: false } });
  await c.insertOne(fixture.permission('9', H2, { event_key: 'ev:y', permission_mask: 3 }));
  assert.equal(await c.countDocuments({ asset_id: '9', grantee_did_hash: H2, active: true }), 1);
});

test('DB-SCHEMA-017: merkle_root_versions unique (did_hash, version)', async (t) => {
  const { db } = state;
  const c = db.collection('merkle_root_versions');
  await c.insertOne(fixture.rootVersion(H1, 1));
  await assert.rejects(() => c.insertOne(fixture.rootVersion(H1, 1)), /duplicate|E11000/i);
  await c.insertOne(fixture.rootVersion(H1, 2));
  await c.insertOne(fixture.rootVersion(H2, 1));
});

test('DB-SCHEMA-018: leaf snapshots unique on (did,root_version,asset_id) AND (did,root_version,ordinal)', async (t) => {
  const { db } = state;
  const c = db.collection('merkle_leaf_snapshots');
  await c.insertOne(fixture.leafSnapshot(H1, 1, '10', 0));
  await assert.rejects(() => c.insertOne(fixture.leafSnapshot(H1, 1, '10', 1)), /duplicate|E11000/i); // same asset
  await assert.rejects(() => c.insertOne(fixture.leafSnapshot(H1, 1, '11', 0)), /duplicate|E11000/i); // same ordinal
  await c.insertOne(fixture.leafSnapshot(H1, 1, '11', 1));
  await c.insertOne(fixture.leafSnapshot(H1, 2, '10', 0)); // new root version ok
});



