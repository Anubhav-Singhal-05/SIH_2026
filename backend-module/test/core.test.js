import { createHash } from 'node:crypto';
import { IdempotencyRepository, digestFor } from '../src/idempotency.js';
import { makeFixture, test, assert, ErrorCode, didHash, ALICE_DID, BOB_DID, EMPTY_ROOT } from './helpers.js';

test('BE-PIPE-008: same key + same digest replays the stored response', () => {
  const repo = new IdempotencyRepository(3600);
  const caller = didHash(ALICE_DID);
  const digest = digestFor('POST', '/assets/mint-intent', { a: 1 });
  const r1 = repo.reserve(caller, 'key-1', '/assets/mint-intent', digest);
  repo.complete(r1, 200, { ok: true });
  const r2 = repo.reserve(caller, 'key-1', '/assets/mint-intent', digest);
  assert.equal(r2, r1);
  assert.deepEqual(r2.responseBody, { ok: true });
});

test('BE-PIPE-009: same key + different digest -> IDEMPOTENCY_CONFLICT', () => {
  const repo = new IdempotencyRepository(3600);
  const caller = didHash(ALICE_DID);
  repo.reserve(caller, 'key-2', '/x', 'digest-a');
  assert.throws(
    () => repo.reserve(caller, 'key-2', '/x', 'digest-b'),
    (err) => err.code === ErrorCode.IDEMPOTENCY_CONFLICT,
  );
});

test('idempotency keys are scoped per caller DID', () => {
  const repo = new IdempotencyRepository(3600);
  repo.reserve(didHash(ALICE_DID), 'k', '/x', 'd');
  assert.doesNotThrow(() => repo.reserve(didHash(BOB_DID), 'k', '/x', 'd'));
});

test('BE-PIPE-010: expired idempotency records are released', () => {
  const repo = new IdempotencyRepository(0);
  repo.reserve(didHash(ALICE_DID), 'k', '/x', 'd');
  assert.doesNotThrow(() => repo.reserve(didHash(ALICE_DID), 'k', '/x', 'd2'));
});

async function stage(f, alice, contentType = 'application/pdf', size = 1024) {
  const intent = await f.assets.createUploadIntent(alice, contentType, size);
  const { writeFile } = await import('node:fs/promises');
  const data = Buffer.alloc(size, 7);
  await writeFile(intent.uploadUrl, data);
  return { intent, checksum: createHash('sha256').update(data).digest('hex'), size };
}

test('BE-MINT-001: upload intent requires an authenticated ACTIVE DID', async () => {
  const f = await makeFixture();
  await assert.rejects(
    f.assets.createUploadIntent(didHash(BOB_DID), 'application/pdf', 100),
    (err) => err.code === ErrorCode.DOCUMENT_NOT_READY,
  );
});

test('BE-MINT-002/003: MIME allowlist and size policy enforced', async () => {
  const f = await makeFixture();
  const alice = didHash(ALICE_DID);
  f.repo.identitiesRepo.upsert({ did: ALICE_DID, didHash: alice, controller: '0x1', encryptionKeyHash: '0x2', status: 'ACTIVE' });
  await assert.rejects(
    f.assets.createUploadIntent(alice, 'application/x-msdownload', 100),
    (err) => err.code === ErrorCode.INVALID_REQUEST,
  );
  await assert.rejects(
    f.assets.createUploadIntent(alice, 'application/pdf', f.config.uploadMaxBytes + 1),
    (err) => err.code === ErrorCode.INVALID_REQUEST,
  );
});

test('BE-MINT-004/005: staged object verifies checksum + size, never plaintext', async () => {
  const f = await makeFixture();
  const alice = didHash(ALICE_DID);
  f.repo.identitiesRepo.upsert({ did: ALICE_DID, didHash: alice, controller: '0x1', encryptionKeyHash: '0x2', status: 'ACTIVE' });
  const { intent, checksum, size } = await stage(f, alice);
  const result = await f.assets.finalizeUpload(alice, {
    stagedId: intent.stagedId,
    expectedChecksumSha256: checksum,
    expectedByteSize: size,
  });
  assert.equal(result.status, 'STAGED');
});

test('BE-MINT-006: STORAGE_FINALIZATION_FAILED on checksum or size mismatch', async () => {
  const f = await makeFixture();
  const alice = didHash(ALICE_DID);
  f.repo.identitiesRepo.upsert({ did: ALICE_DID, didHash: alice, controller: '0x1', encryptionKeyHash: '0x2', status: 'ACTIVE' });
  const { intent, checksum, size } = await stage(f, alice);
  await assert.rejects(
    f.assets.finalizeUpload(alice, { stagedId: intent.stagedId, expectedChecksumSha256: 'ff'.repeat(32), expectedByteSize: size }),
    (err) => err.code === ErrorCode.STORAGE_FINALIZATION_FAILED,
  );
  await assert.rejects(
    f.assets.finalizeUpload(alice, { stagedId: intent.stagedId, expectedChecksumSha256: checksum, expectedByteSize: size - 1 }),
    (err) => err.code === ErrorCode.STORAGE_FINALIZATION_FAILED,
  );
});
