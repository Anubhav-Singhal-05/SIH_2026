// Merkle service suite C — reconciliation and root-update failure policy.

import test from 'node:test';
import assert from 'node:assert/strict';
import { withEphemeralDb, H, OWNER, GRANTEE } from './harness.js';
import { MerkleService } from '../src/modules/merkle/service.js';
import { normalizeHex32 } from '@sih/protocol';
import { uuidv7 } from '@sih/database/uuid7';
import { seedRoot, L1, L2 } from './merkle-a.test.js';

test('reconcileRoot detects DRIFT and NEEDS_REFRESH', async () => {
  await withEphemeralDb(async (db) => {
    const root = await seedRoot(db, OWNER, 1, [{ assetId: '10', leafHash: L1 }]);
    const svc2 = new MerkleService(db, { directRootRead: async () => H(0xee) });
    const d = await svc2.reconcileRoot(OWNER, 1);
    assert.equal(d.status, 'DRIFT');
    assert.ok(await db.collection('indexer_alerts').findOne({ type: 'root_mismatch' })); // block + alert
    await seedRoot(db, OWNER, 2, [{ assetId: '10', leafHash: L1 }, { assetId: '20', leafHash: L2 }]);
    const root2 = (await db.collection('merkle_root_versions').findOne({ did_hash: normalizeHex32(OWNER), version: 2 })).root;
    const svc3 = new MerkleService(db, { directRootRead: async (d, v) => (v === 2n ? root2 : root) });
    const s = await svc3.reconcileRoot(OWNER, 1);
    assert.equal(s.status, 'NEEDS_REFRESH'); // stale -> recompute from final state
    assert.equal(s.latestVersion, 2);
    const ok = await svc3.reconcileRoot(OWNER, 2);
    assert.equal(ok.status, 'OK');
  });
});

test('root-update failure policy: P1 (asset event without root event) and QUARANTINE branches', async () => {
  await withEphemeralDb(async (db) => {
    const didHash = normalizeHex32(OWNER);
    await db.collection('assets').insertOne({
      asset_id: '10', owner_did_hash: didHash, status: 'active', document_hash: H(0x55),
      metadata_hash: H(0x66), storage_commitment: H(0x77), current_version: 1,
      event_key: 'ev:p1', finalized: true,
    });
    await db.collection('chain_events').insertOne({
      chain_id: 31337, tx_hash: H(0x91), log_index: 0, tx_index: 0, block_number: 50,
      contract: 'AssetRegistry', abi_version: '1', name: 'AssetTransferred', finalized: true, canonical: true,
      payload: { assetId: '10', fromDidHash: GRANTEE, toDidHash: didHash }, dead_letter: false, dead_letter_reason: null,
    });
    const svc = new MerkleService(db);
    const r = await svc.reconcileRoot(OWNER, 9);
    assert.equal(r.status, 'P1'); // atomicity invariant violated / ABI or indexer fault
    assert.ok(await db.collection('indexer_alerts').findOne({ level: 'P1' }));

    await seedRoot(db, GRANTEE, 3, []);
    const opId = uuidv7();
    await db.collection('operations').insertOne({
      id: opId, caller_did_hash: normalizeHex32(GRANTEE), idempotency_key: 'k1', request_hash: H(0x01),
      type: 'mint', status: 'PENDING', transaction_hash: null, expiry: null, created_at: new Date(),
    });
    const q = await svc.reconcileRoot(GRANTEE, 3);
    assert.equal(q.status, 'QUARANTINE'); // quarantine the operation, reconcile chain state
    assert.equal((await db.collection('operations').findOne({ id: opId })).status, 'QUARANTINED');
    assert.ok(await db.collection('indexer_alerts').findOne({ level: 'quarantine' }));
  });
});

test('verifyAllSnapshots recomputes every stored root snapshot (DB-ACCEPT-002)', async () => {
  await withEphemeralDb(async (db) => {
    await seedRoot(db, OWNER, 1, [{ assetId: '10', leafHash: L1 }, { assetId: '20', leafHash: L2 }]);
    await db.collection('merkle_leaf_snapshots').updateOne({ asset_id: '10' }, { $set: { leaf_hash: H(0x99) } });
    const { verifyAllSnapshots } = await import('../src/workers/reconciler/index.js');
    const res = await verifyAllSnapshots(db);
    assert.equal(res.checked, 1);
    assert.equal(res.failures.length, 1); // drift detected
  });
});
