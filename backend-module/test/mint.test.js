import { makeFixture, test, assert, ErrorCode, didHash, ALICE_DID, EMPTY_ROOT } from './helpers.js';

async function stage(f, alice, size = 512) {
  const intent = await f.assets.createUploadIntent(alice, 'application/pdf', size);
  const { writeFile } = await import('node:fs/promises');
  const { createHash } = await import('node:crypto');
  const data = Buffer.alloc(size, 9);
  await writeFile(intent.uploadUrl, data);
  await f.assets.finalizeUpload(alice, {
    stagedId: intent.stagedId,
    expectedChecksumSha256: createHash('sha256').update(data).digest('hex'),
    expectedByteSize: size,
  });
  return intent.stagedId;
}

function activeAlice(f) {
  const alice = didHash(ALICE_DID);
  f.repo.identitiesRepo.upsert({ did: ALICE_DID, didHash: alice, controller: '0x1', encryptionKeyHash: '0x2', status: 'ACTIVE' });
  f.chain.roots.set(alice, { root: EMPTY_ROOT, version: 0n });
  return alice;
}

test('BE-MINT-007/009: mint intent validates issuer role and staged document', async () => {
  const f = await makeFixture();
  activeAlice(f);
  const stagedId = await stage(f, didHash(ALICE_DID));
  await assert.rejects(
    f.assets.createMintIntent({ callerDid: ALICE_DID, ownerDid: ALICE_DID, stagedId, issuerRole: false, verified: true, requestDigest: 'd' }),
    (err) => err.code === ErrorCode.FORBIDDEN,
  );
  await assert.rejects(
    f.assets.createMintIntent({ callerDid: ALICE_DID, ownerDid: ALICE_DID, stagedId: 'nope', issuerRole: true, verified: true, requestDigest: 'd' }),
    (err) => err.code === ErrorCode.DOCUMENT_NOT_READY,
  );
});

test('BE-MINT-011: STALE_ROOT when projection diverges from chain', async () => {
  const f = await makeFixture();
  const alice = activeAlice(f);
  const stagedId = await stage(f, alice);
  f.chain.roots.set(alice, { root: EMPTY_ROOT, version: 5n }); // projection still at 0
  await assert.rejects(
    f.assets.createMintIntent({ callerDid: ALICE_DID, ownerDid: ALICE_DID, stagedId, issuerRole: true, verified: true, requestDigest: 'd' }),
    (err) => err.code === ErrorCode.STALE_ROOT,
  );
});

test('BE-STEPUP-003: operation persisted AWAITING_STEP_UP before challenge verification', async () => {
  const f = await makeFixture();
  activeAlice(f);
  const stagedId = await stage(f, didHash(ALICE_DID));
  const res = await f.assets.createMintIntent({ callerDid: ALICE_DID, ownerDid: ALICE_DID, stagedId, issuerRole: true, verified: false, requestDigest: 'd' });
  assert.equal(f.repo.getOperation(res.operationId).status, 'AWAITING_STEP_UP');
  assert.equal(res.permit.signature, '0x'); // unsigned until verified
});

test('BE-STEPUP-002/006/007 + BE-MINT-015: HSM-signed permit bound to exact operation', async () => {
  const f = await makeFixture();
  activeAlice(f);
  const stagedId = await stage(f, didHash(ALICE_DID));
  const res = await f.assets.createMintIntent({ callerDid: ALICE_DID, ownerDid: ALICE_DID, stagedId, issuerRole: true, verified: true, requestDigest: 'd' });

  assert.match(res.calldata, /^0x[0-9a-f]+$/);
  assert.ok(res.calldata.length > 100);
  assert.equal(res.permit.signature.length, 132); // 65-byte ECDSA signature

  const op = f.repo.getOperation(res.operationId);
  assert.equal(op.status, 'AWAITING_WALLET_SIGNATURE');
  assert.match(op.permitDigest, /^0x[0-9a-f]{64}$/);
  assert.equal(op.permitDigest, res.permit.operationHash);
  assert.ok(op.permitExpiresAt > Math.floor(Date.now() / 1000));
  assert.ok(op.permitExpiresAt <= Math.floor(Date.now() / 1000) + 301); // 5-minute expiry
  assert.equal(op.reservedAssetId, res.assetId);
});

test('BE-MINT-017/021 + BE-DOD-003: CONFIRMED only from finalized event', async () => {
  const f = await makeFixture();
  const alice = activeAlice(f);
  const stagedId = await stage(f, alice);
  const res = await f.assets.createMintIntent({ callerDid: ALICE_DID, ownerDid: ALICE_DID, stagedId, issuerRole: true, verified: true, requestDigest: 'd' });

  // Receipt/submission alone never confirms (BE-MINT-018/019/020).
  assert.equal(f.repo.getAsset(BigInt(res.assetId)), undefined);
  assert.equal(f.repo.getStaged(stagedId).status, 'STAGED');

  const event = {
    chainId: 31337,
    txHash: '0x' + 'ab'.repeat(32),
    logIndex: 0,
    assetId: res.assetId,
    ownerDidHash: alice,
    documentHash: '0x' + '11'.repeat(32),
    metadataHash: '0x' + '22'.repeat(32),
  };
  f.assets.finalizeChainEvent(event);
  assert.equal(f.repo.getAsset(BigInt(res.assetId)).status, 'ACTIVE');

  // Duplicate event ingestion is a no-op (BE-CHAIN idempotent event ledger).
  const vBefore = f.repo.activeLeaves(alice).oldVersion;
  f.assets.finalizeChainEvent(event);
  assert.equal(f.repo.activeLeaves(alice).oldVersion, vBefore);
});
