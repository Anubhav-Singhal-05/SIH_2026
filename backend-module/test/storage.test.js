import { LocalStorageService } from '../src/storage.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, assert, ErrorCode } from './helpers.js';

function makeStorage() {
  return new LocalStorageService(mkdtempSync(join(tmpdir(), 'stor-')), 60);
}

test('BE-STORAGE-005: only checksum, MIME policy, size accepted; invalid rejected', async () => {
  const s = makeStorage();
  await assert.rejects(
    s.createUploadIntent({ checksumSha256: 'not-hex', contentType: 'application/pdf', maxBytes: 100 }),
    (err) => err.code === ErrorCode.INVALID_REQUEST,
  );
});

test('BE-STORAGE-004: unbounded uploads rejected', async () => {
  const s = makeStorage();
  await assert.rejects(
    s.createUploadIntent({ checksumSha256: 'ab'.repeat(32), contentType: 'application/pdf', maxBytes: 0 }),
    (err) => err.code === ErrorCode.INVALID_REQUEST,
  );
  await assert.rejects(
    s.createUploadIntent({ checksumSha256: 'ab'.repeat(32), contentType: 'application/pdf', maxBytes: 2_000_000_000 }),
    (err) => err.code === ErrorCode.INVALID_REQUEST,
  );
});

test('BE-STORAGE-002/003: server-chosen keys; traversal denied', async () => {
  const s = makeStorage();
  const scoped = await s.createUploadIntent({ checksumSha256: 'ab'.repeat(32), contentType: 'application/pdf', maxBytes: 100 });
  assert.match(scoped.objectKey, /^staged\/[0-9a-f-]{36}\.bin$/);
  assert.throws(() => s['#safePath']('../../etc/passwd'));
  assert.throws(() => new LocalStorageService('/tmp', 60)['#safePath']('/etc/passwd'));
});

test('BE-STORAGE-006: finalize verifies checksum and byte count', async () => {
  const s = makeStorage();
  const { writeFile } = await import('node:fs/promises');
  const { createHash } = await import('node:crypto');
  const scoped = await s.createUploadIntent({ checksumSha256: 'ab'.repeat(32), contentType: 'application/pdf', maxBytes: 100 });
  const data = Buffer.alloc(64, 1);
  await writeFile(scoped.uploadUrl, data);
  await assert.rejects(
    s.finalizeStagedObject(scoped.stagedId, scoped.objectKey, { stagedId: scoped.stagedId, expectedChecksumSha256: 'ab'.repeat(32), expectedByteSize: 64 }),
    (err) => err.code === ErrorCode.STORAGE_FINALIZATION_FAILED,
  );
  await s.finalizeStagedObject(scoped.stagedId, scoped.objectKey, {
    stagedId: scoped.stagedId,
    expectedChecksumSha256: createHash('sha256').update(data).digest('hex'),
    expectedByteSize: 64,
  });
});

test('BE-STORAGE-007: download URL is scoped and time-limited; missing -> DOCUMENT_NOT_READY', async () => {
  const s = makeStorage();
  const { writeFile } = await import('node:fs/promises');
  const scoped = await s.createUploadIntent({ checksumSha256: 'ab'.repeat(32), contentType: 'application/pdf', maxBytes: 100 });
  await writeFile(scoped.uploadUrl, Buffer.alloc(10, 2));
  await assert.rejects(
    s.createDownloadIntent('missing.bin'),
    (err) => err.code === ErrorCode.DOCUMENT_NOT_READY,
  );
  const dl = await s.createDownloadIntent(scoped.objectKey);
  assert.ok(dl.downloadUrl.includes('token='));
  assert.ok(new Date(dl.expiresAt).getTime() > Date.now());
});

test('BE-STORAGE-011: no public URL or raw object reference is produced', async () => {
  const s = makeStorage();
  const scoped = await s.createUploadIntent({ checksumSha256: 'ab'.repeat(32), contentType: 'application/pdf', maxBytes: 100 });
  assert.doesNotMatch(scoped.uploadUrl, /^https?:\/\//);
  assert.ok(!scoped.objectKey.includes('http'));
});
