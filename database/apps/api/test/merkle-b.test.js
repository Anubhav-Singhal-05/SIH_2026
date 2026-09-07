// Merkle service suite B part 1 — proofs and snapshot immutability.

import test from 'node:test';
import assert from 'node:assert/strict';
import { withEphemeralDb, H, OWNER, GRANTEE } from './harness.js';
import { MerkleService, ALGORITHM_LABEL } from '../src/modules/merkle/service.js';
import { emptyRoot, normalizeHex32 } from '@sih/protocol';
import { seedRoot, L1, L2, L3 } from './merkle-a.test.js';

test('generateProof for odd count; response shape; verifyProof true/false cases', async () => {
  await withEphemeralDb(async (db) => {
    const svc = new MerkleService(db);
    const root = await seedRoot(db, OWNER, 5, [
      { assetId: '10', leafHash: L1 }, { assetId: '20', leafHash: L2 }, { assetId: '30', leafHash: L3 },
    ]);
    for (const assetId of ['10', '20', '30']) {
      const proof = await svc.generateProof({ didHash: OWNER, assetId, rootVersion: 5 });
      assert.equal(proof.algorithm, ALGORITHM_LABEL);          // algorithm label
      assert.equal(proof.didHash, normalizeHex32(OWNER));     // DID hash
      assert.equal(proof.root, root);                          // root
      assert.equal(proof.rootVersion, 5);                      // root version
      assert.equal(proof.assetId, assetId);                    // asset id
      assert.ok(proof.leaf.startsWith('0x'));                  // leaf
      assert.equal(typeof proof.ordinal, 'number');            // leaf ordinal
      assert.ok(Array.isArray(proof.siblings));                // ordered siblings
      assert.equal(proof.selfVerified, true);                  // self-verification
      assert.equal(await svc.verifyProof(proof), true);
    }
    const proof = await svc.generateProof({ didHash: OWNER, assetId: '20', rootVersion: 5 });
    assert.equal(await svc.verifyProof({ ...proof, siblings: [H(0x01), ...proof.siblings.slice(1)] }), false); // altered sibling
    assert.equal(await svc.verifyProof({ ...proof, leaf: L1 }), false);   // altered leaf
    assert.equal(await svc.verifyProof({ ...proof, root: emptyRoot() }), false); // wrong root version
    await assert.rejects(() => svc.generateProof({ didHash: OWNER, assetId: '99', rootVersion: 5 }), /not in snapshot/);
    await assert.rejects(() => svc.generateProof({ didHash: GRANTEE, assetId: '10', rootVersion: 5 }), /no snapshot/);
    await seedRoot(db, GRANTEE, 1, []);
    await assert.rejects(() => svc.generateProof({ didHash: GRANTEE, assetId: '10', rootVersion: 1 }), /no snapshot/);
  });
});

test('snapshot persisted only after matching FINAL MerkleRootUpdated; immutable at write layer', async () => {
  await withEphemeralDb(async (db) => {
    const svc = new MerkleService(db);
    const leaves = [{ assetId: '10', leafHash: L1, ordinal: 0 }];
    await db.collection('merkle_root_versions').insertOne({
      did_hash: normalizeHex32(OWNER), version: 7, root: H(0xc7), operation_hash: H(0xd7),
      block_number: 107, tx_hash: H(0xa7), finalized: false,
    });
    await assert.rejects(() => svc.persistSnapshot(OWNER, 7, leaves), /no FINAL MerkleRootUpdated/);
    await db.collection('merkle_root_versions').updateOne({ version: 7 }, { $set: { finalized: true } });
    await svc.persistSnapshot(OWNER, 7, leaves);
    assert.equal(await db.collection('merkle_leaf_snapshots').countDocuments({ did_hash: normalizeHex32(OWNER), root_version: 7 }), 1);
    await assert.rejects(() => svc.persistSnapshot(OWNER, 7, leaves), /immutable/); // no update path
  });
});
