import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../src/server.js';
import { didHash as computeDidHash } from '../src/did.js';
import { EMPTY_ROOT } from '../src/merkle.js';

const ALICE_DID = 'did:sih:0000000000000000000000000000000000000000000000000000000000000001';
const BOB_DID = 'did:sih:0000000000000000000000000000000000000000000000000000000000000002';

async function setupFixture() {
  const aliceHash = computeDidHash(ALICE_DID);
  const bobHash = computeDidHash(BOB_DID);

  const { loadConfig } = await import('../src/config.js');
  const { ChainGateway } = await import('../src/chain-gateway.js');
  const config = loadConfig();
  const mockChain = new ChainGateway({
    manifestPath: config.deploymentManifestPath,
    artifactsDir: '../blockchain-module/out',
    rpcUrls: [config.chainRpcUrl],
    chainId: config.chainId,
  });

  const roots = new Map([
    [aliceHash.toLowerCase(), { root: EMPTY_ROOT, version: 0n }],
    [bobHash.toLowerCase(), { root: EMPTY_ROOT, version: 0n }],
  ]);
  mockChain.getRoot = async (didHash) => roots.get(didHash.toLowerCase()) ?? { root: EMPTY_ROOT, version: 0n };

  const fixture = buildServer({ chain: mockChain });
  await fixture.app.ready();

  // Register credentials and setup active identities
  fixture.auth.registerCredential(ALICE_DID, 'cred-alice');
  fixture.auth.registerCredential(BOB_DID, 'cred-bob');

  fixture.repo.identitiesRepo.upsert({
    did: ALICE_DID,
    didHash: aliceHash,
    controller: '0x1111111111111111111111111111111111111111',
    status: 'ACTIVE',
  });
  fixture.repo.identitiesRepo.upsert({
    did: BOB_DID,
    didHash: bobHash,
    controller: '0x2222222222222222222222222222222222222222',
    status: 'ACTIVE',
  });

  // Login Alice
  const chal = fixture.auth.createChallenge(ALICE_DID);
  fixture.auth.verifyAssertion(chal, { credentialId: 'cred-alice', signatureOk: true, counter: 1 });
  const aliceTokens = fixture.auth.issueTokens(aliceHash);

  return { ...fixture, aliceTokens, aliceHash, bobHash, mockChain };
}

test('GET /identities/:did/resolve resolves an active identity', async () => {
  const f = await setupFixture();
  const res = await f.app.inject({
    method: 'GET',
    url: `/identities/${ALICE_DID}/resolve`,
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.did, ALICE_DID);
  assert.equal(body.status, 'ACTIVE');
});

test('GET /assets and GET /assets/:assetId returns asset and versions', async () => {
  const f = await setupFixture();
  const assetId = '1001';

  f.repo.upsertAsset({
    assetId,
    ownerDidHash: f.aliceHash,
    documentHash: '0x' + 'aa'.repeat(32),
    metadataHash: '0x' + 'bb'.repeat(32),
    documentVersion: 1,
    status: 'ACTIVE',
  });

  const listRes = await f.app.inject({
    method: 'GET',
    url: `/assets?ownerDidHash=${f.aliceHash}`,
    headers: { authorization: `Bearer ${f.aliceTokens.accessToken}` },
  });
  assert.equal(listRes.statusCode, 200);
  assert.equal(listRes.json().items.length, 1);
  assert.equal(listRes.json().items[0].assetId, assetId);

  const detailRes = await f.app.inject({
    method: 'GET',
    url: `/assets/${assetId}`,
    headers: { authorization: `Bearer ${f.aliceTokens.accessToken}` },
  });
  assert.equal(detailRes.statusCode, 200);
  assert.equal(detailRes.json().asset.assetId, assetId);
  assert.ok(Array.isArray(detailRes.json().versions));
});

test('POST /assets/:assetId/transfer-intent generates signed transfer calldata', async () => {
  const f = await setupFixture();
  const assetId = '1002';

  f.repo.upsertAsset({
    assetId,
    ownerDidHash: f.aliceHash,
    documentHash: '0x' + 'aa'.repeat(32),
    metadataHash: '0x' + 'bb'.repeat(32),
    documentVersion: 1,
    status: 'ACTIVE',
  });

  const res = await f.app.inject({
    method: 'POST',
    url: `/assets/${assetId}/transfer-intent`,
    headers: {
      authorization: `Bearer ${f.aliceTokens.accessToken}`,
      'idempotency-key': '0192e2fb-a79e-7111-a888-999999999999',
    },
    payload: {
      callerDid: ALICE_DID,
      toDid: BOB_DID,
      verified: true,
    },
  });

  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.assetId, assetId);
  assert.equal(body.fromDid, ALICE_DID);
  assert.equal(body.toDid, BOB_DID);
  assert.match(body.calldata, /^0x/);
  assert.ok(body.permit.signature.length > 10);
});

test('POST /assets/:assetId/access-grant-intent and access-revoke-intent', async () => {
  const f = await setupFixture();
  const assetId = '1003';

  f.repo.upsertAsset({
    assetId,
    ownerDidHash: f.aliceHash,
    documentHash: '0x' + 'aa'.repeat(32),
    metadataHash: '0x' + 'bb'.repeat(32),
    documentVersion: 1,
    status: 'ACTIVE',
  });

  const grantRes = await f.app.inject({
    method: 'POST',
    url: `/assets/${assetId}/access-grant-intent`,
    headers: {
      authorization: `Bearer ${f.aliceTokens.accessToken}`,
      'idempotency-key': '0192e2fb-a79e-7222-a888-999999999999',
    },
    payload: {
      callerDid: ALICE_DID,
      granteeDid: BOB_DID,
      permissionMask: 1, // READ
      verified: true,
    },
  });

  assert.equal(grantRes.statusCode, 200);
  assert.equal(grantRes.json().permissionMask, 1);
  assert.match(grantRes.json().calldata, /^0x/);

  const revokeRes = await f.app.inject({
    method: 'POST',
    url: `/assets/${assetId}/access-revoke-intent`,
    headers: {
      authorization: `Bearer ${f.aliceTokens.accessToken}`,
      'idempotency-key': '0192e2fb-a79e-7333-a888-999999999999',
    },
    payload: {
      callerDid: ALICE_DID,
      granteeDid: BOB_DID,
      verified: true,
    },
  });

  assert.equal(revokeRes.statusCode, 200);
  assert.match(revokeRes.json().calldata, /^0x/);
});

test('POST /verification/documents and GET /verification/merkle-proofs', async () => {
  const f = await setupFixture();
  const assetId = '1004';
  const docHash = '0x' + 'dd'.repeat(32);

  f.repo.upsertAsset({
    assetId,
    ownerDidHash: f.aliceHash,
    documentHash: docHash,
    metadataHash: '0x' + 'ee'.repeat(32),
    documentVersion: 1,
    status: 'ACTIVE',
  });

  const verifyRes = await f.app.inject({
    method: 'POST',
    url: '/verification/documents',
    headers: { authorization: `Bearer ${f.aliceTokens.accessToken}` },
    payload: { assetId, documentHash: docHash },
  });

  assert.equal(verifyRes.statusCode, 200);
  assert.equal(verifyRes.json().verified, true);

  const proofRes = await f.app.inject({
    method: 'GET',
    url: `/verification/merkle-proofs?didHash=${f.aliceHash}&assetId=${assetId}`,
    headers: { authorization: `Bearer ${f.aliceTokens.accessToken}` },
  });

  assert.equal(proofRes.statusCode, 200);
  assert.equal(proofRes.json().assetId, assetId);
  assert.equal(proofRes.json().verified, true);
});
