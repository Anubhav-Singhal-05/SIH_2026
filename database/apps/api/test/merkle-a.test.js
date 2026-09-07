// Merkle service suite A â€” golden vectors, intent transitions, drift rejection.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { withEphemeralDb, H, OWNER, GRANTEE, leaf as leafOf } from './harness.js';
import { MerkleService, RootDriftError, leafFor, operationDigest, ALGORITHM_LABEL } from '../src/modules/merkle/service.js';
import { emptyRoot, computeRoot, normalizeHex32 } from '@sih/protocol';

export const VECTORS = JSON.parse(
  await readFile(fileURLToPath(new URL('../../../packages/protocol/test-vectors/merkle-vectors.json', import.meta.url)), 'utf8'),
);

export const L1 = leafOf('10');
export const L2 = leafOf('20');
export const L3 = leafOf('30');

/** Seed a finalized root version + snapshot leaves, bypassing the indexer. */
export async function seedRoot(db, didHash, version, leaves, { finalized = true, root } = {}) {
  const computed = root ?? (leaves.length ? computeRoot(leaves) : emptyRoot());
  await db.collection('merkle_root_versions').insertOne({
    did_hash: normalizeHex32(didHash), version, root: computed, operation_hash: H(0xd0 + version),
    block_number: 100 + version, tx_hash: H(0xa0 + version), finalized,
  });
  if (leaves.length) {
    await db.collection('merkle_leaf_snapshots').bulkWrite(leaves.map((l, i) => ({
      insertOne: {
        did_hash: normalizeHex32(didHash), root_version: version, asset_id: String(l.assetId),
        leaf_hash: l.leafHash, ordinal: i, root: computed, created_at: new Date(),
      },
    })));
  }
  return computed;
}

test('leaf/parent/EMPTY_ROOT formulas match golden vectors exactly (service runtime parity)', async () => {
  assert.equal(leafFor(VECTORS.leaf_vectors[0].input), VECTORS.leaf_vectors[0].leaf);
  assert.equal(leafFor(VECTORS.leaf_vectors[1].input), VECTORS.leaf_vectors[1].leaf);
  assert.equal(emptyRoot(), VECTORS.empty_root);
  // golden-vector parity with the frozen vector module (same source for any runtime)
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const vec = require('@sih/protocol/vectors');
  assert.equal(vec.empty_root, VECTORS.empty_root);
  assert.equal(vec.leaf_vectors[0].leaf, VECTORS.leaf_vectors[0].leaf);
});

test('prepareMint: zero->one leaf, correct transition, ordering enforced', async () => {
  await withEphemeralDb(async (db) => {
    const svc = new MerkleService(db);
    const seed = await seedRoot(db, OWNER, 1, []); // empty state, root == EMPTY_ROOT
    assert.equal(seed, emptyRoot());
    const t = await svc.prepareMint({
      didHash: OWNER, assetId: '10', ownerDidHash: OWNER, documentHash: H(0x55),
      metadataHash: H(0x66), documentVersion: 1, expectedVersion: 2, expectedOldRoot: seed,
    });
    assert.equal(t.before.root, emptyRoot());
    assert.equal(t.after.root, L1); // single leaf is the root
    assert.equal(t.after.version, 2);
    assert.equal(t.operationHash, operationDigest(OWNER, L1, 2));
  });
});

test('prepareDocumentUpdate / prepareTransfer / prepareDeactivation produce correct transitions', async () => {
  await withEphemeralDb(async (db) => {
    const svc = new MerkleService(db);
    const root = await seedRoot(db, OWNER, 1, [
      { assetId: '10', leafHash: L1 }, { assetId: '20', leafHash: L2 }, { assetId: '30', leafHash: L3 },
    ]);
    const u = await svc.prepareDocumentUpdate({
      didHash: OWNER, assetId: '20', ownerDidHash: OWNER, documentHash: H(0x77),
      metadataHash: H(0x66), documentVersion: 2, expectedVersion: 2, expectedOldRoot: root,
    });
    const newLeaf = leafFor({ assetId: '20', ownerDidHash: OWNER, documentHash: H(0x77), metadataHash: H(0x66), documentVersion: 2 });
    assert.equal(u.after.leaves.find((l) => l.assetId === '20').leafHash, newLeaf);
    assert.notEqual(u.after.root, root);

    const d = await svc.prepareDeactivation({ didHash: OWNER, assetId: '30', expectedVersion: 2, expectedOldRoot: root });
    assert.equal(d.after.leaves.length, 2);

    const toRoot = await seedRoot(db, GRANTEE, 1, []);
    const t = await svc.prepareTransfer({
      fromDidHash: OWNER, toDidHash: GRANTEE, assetId: '30',
      fromLeaf: { assetId: '30', leafHash: L3 },
      expectedFromVersion: 2, expectedFromOldRoot: root,
      expectedToVersion: 2, expectedToOldRoot: toRoot,
    });
    assert.equal(t.from.after.leaves.length, 2);
    assert.equal(t.to.after.leaves.length, 1);
    assert.equal(t.to.after.root, L3);
  });
});

test('prepare* rejects drift: projection cannot reproduce expected old root -> block + alert', async () => {
  await withEphemeralDb(async (db) => {
    const alerts = [];
    const svc = new MerkleService(db, { onAlert: async (a) => alerts.push(a) });
    await seedRoot(db, OWNER, 1, [{ assetId: '10', leafHash: L1 }]);
    await assert.rejects(
      () => svc.prepareMint({
        didHash: OWNER, assetId: '20', ownerDidHash: OWNER, documentHash: H(0x55),
        metadataHash: H(0x66), documentVersion: 1, expectedVersion: 2, expectedOldRoot: emptyRoot(),
      }),
      RootDriftError,
    );
    assert.equal(alerts.length, 1); // reconciliation alert raised
    assert.ok(await db.collection('indexer_alerts').findOne({ type: 'root_mismatch' }));
  });
});
