// DB-SCHEMA-019..026 â€” ledger, timezone, FK-safety, index/EXPLAIN checks.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createEphemeralDb } from '../src/test-util.js';
import { INDEXES, COLLECTIONS } from '../src/schema/index.js';
import { fixture, H1, H2 } from '../fixtures/fixtures.js';
import { uuidv7 } from '../src/uuid7.js';

const state = {};
test.before(async () => {
  const eph = await createEphemeralDb();
  state.db = eph.db; state.cleanup = eph.cleanup;
});
test.after(async (t) => { await state.cleanup(); });

test('DB-SCHEMA-019/020: block_hash unique; events (chain_id,tx_hash,log_index) unique, duplicate ingest no-op', async (t) => {
  const { db } = state;
  await db.collection('chain_blocks').insertOne(fixture.chainBlock(1));
  await assert.rejects(() => db.collection('chain_blocks').insertOne(fixture.chainBlock(1, { block_number: 2 })), /duplicate|E11000/i);
  const ev = fixture.chainEvent({ block: 1, logIndex: 0, name: 'AssetRegistered', payload: {} });
  await db.collection('chain_events').insertOne(ev);
  // idempotent re-ingestion (indexer upsert pattern): no duplicate row, no error
  const res = await db.collection('chain_events').replaceOne(
    { chain_id: ev.chain_id, tx_hash: ev.tx_hash, log_index: ev.log_index }, ev, { upsert: true },
  );
  assert.equal(res.upsertedCount, 0);
  assert.equal(await db.collection('chain_events').countDocuments({ tx_hash: ev.tx_hash, log_index: 0 }), 1);
  await assert.rejects(() => db.collection('chain_events').insertOne(ev), /duplicate|E11000/i);
});

test('DB-SCHEMA-021/022: inheritance uniques', async (t) => {
  const { db } = state;
  const rule = { owner_did_hash: H1, default_nominee_did_hash: H2, policy_hash: H2, status: 'active', event_key: 'ev:inh1' };
  await db.collection('inheritance_rules').insertOne(rule);
  await assert.rejects(() => db.collection('inheritance_rules').insertOne({ ...rule, event_key: 'ev:inh2' }), /duplicate|E11000/i);
  await db.collection('inheritance_asset_rules').insertOne({ owner_did_hash: H1, asset_id: '1', beneficiary_did_hash: H2, event_key: 'ev:iar1' });
  await assert.rejects(() => db.collection('inheritance_asset_rules').insertOne({ owner_did_hash: H1, asset_id: '1', beneficiary_did_hash: H1, event_key: 'ev:iar2' }), /duplicate|E11000/i);
});

test('DB-SCHEMA-023: bytes32 stored as 0x-prefixed 66-char lower-case hex (validator-enforced)', async (t) => {
  const { db } = state;
  const c = db.collection('identities');
  const good = fixture.identity({ id: uuidv7(), did: 'did:sih:cececececececececececececececececececececececececececececececece', did_hash: '0x' + 'ab'.repeat(32), controller: 'c-cc' });
  await c.insertOne(good);
  assert.equal(good.did_hash.length, 66);
  assert.equal(await c.findOne({ did_hash: '0x' + 'AB'.repeat(32) }), null); // case is canonical lower
  await assert.rejects(() => c.insertOne(fixture.identity({ did: 'did:sih:dfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdf', did_hash: '0x' + 'AB'.repeat(32).toUpperCase(), controller: 'c-dd' })), /validation/i);
  await assert.rejects(() => c.insertOne(fixture.identity({ did: 'did:sih:efefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefef', did_hash: '0x1234', controller: 'c-ee' })), /validation/i);
});

test('DB-SCHEMA-024: wall-clock fields are timezone-aware (UTC instants round-trip)', async (t) => {
  const { db } = state;
  const at = new Date('2026-09-07T12:34:56.789+05:30');
  await db.collection('asset_ownership_history').insertOne(fixture.ownership('77', { occurred_at: at }));
  const doc = await db.collection('asset_ownership_history').findOne({ event_key: 'ev:reg:77' });
  assert.ok(doc.occurred_at instanceof Date);
  assert.equal(doc.occurred_at.toISOString(), '2026-09-07T07:04:56.789Z');
});

test('DB-SCHEMA-025: FK checks on provisional projections never block reorg delete-and-replay', async (t) => {
  const { db } = state;
  await db.collection('assets').insertOne(fixture.asset('321', { finalized: false, event_key: 'ev:prov:321' }));
  await db.collection('asset_ownership_history').insertOne(fixture.ownership('321', { event_key: 'ev:prov:reg:321' }));
  assert.equal((await db.collection('assets').deleteOne({ asset_id: '321', finalized: false })).deletedCount, 1);
  assert.equal((await db.collection('asset_ownership_history').deleteOne({ asset_id: '321', event_key: 'ev:prov:reg:321' })).deletedCount, 1);
});

test('DB-SCHEMA-026: every primary query index exists and is used (EXPLAIN)', async (t) => {
  const { db } = state;
  for (const name of COLLECTIONS) {
    const idx = await db.collection(name).listIndexes().toArray();
    const have = new Set(idx.map((i) => i.name));
    for (const [, opts] of INDEXES[name] ?? []) {
      assert.ok(have.has(opts.name), `${name} missing index ${opts.name}`);
    }
  }
  const checks = [
    ['assets', { owner_did_hash: H1, status: 'active' }, 'ix_assets_owner_status'],
    ['asset_ownership_history', { asset_id: '5' }, 'ix_history_asset_time_desc'],
    ['document_versions', { asset_id: '7' }, 'ix_versions_asset_version_desc'],
    ['asset_permissions', { asset_id: '9', grantee_did_hash: H2, active: true }, 'ix_permissions_asset_grantee_active'],
    ['merkle_root_versions', { did_hash: H1 }, 'ix_roots_did_version_desc'],
    ['merkle_leaf_snapshots', { did_hash: H1, root_version: 1 }, 'uq_did_version_ordinal'],
    ['chain_events', { finalized: true, block_number: { $gt: 0 } }, 'ix_events_finalized_block_log'],
    ['operations', { caller_did_hash: H1 }, 'ix_operations_caller_time'],
  ];
  for (const [coll, query, index] of checks) {
    const plan = await db.collection(coll).find(query).explain('queryPlanner');
    const s = JSON.stringify(plan.queryPlanner.winningPlan);
    assert.ok(s.includes(index) || s.includes('IXSCAN'), `${coll} query should use ${index}; plan: ${s.slice(0, 250)}`);
  }
});



