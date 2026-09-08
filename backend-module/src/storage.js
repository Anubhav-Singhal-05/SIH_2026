import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { DomainError, ErrorCode } from './errors.js';

/**
 * StorageService (spec §6) — local filesystem implementation; interface is
 * frozen for the S3 adapter. Guarantees (BE-STORAGE-001..011):
 * no public ACL, server-chosen keys, traversal denied, checksum+size
 * verification only (never plaintext), scoped time-limited URLs.
 */
export class LocalStorageService {
  constructor(rootDir, urlTtlSeconds = 300) {
    this.rootDir = resolve(rootDir);
    this.urlTtlSeconds = urlTtlSeconds;
  }

  async createUploadIntent(input) {
    if (!/^[0-9a-f]{64}$/.test(String(input.checksumSha256).toLowerCase())) {
      throw new DomainError(ErrorCode.INVALID_REQUEST, 'invalid checksum');
    }
    if (input.maxBytes <= 0 || input.maxBytes > 1_000_000_000) {
      throw new DomainError(ErrorCode.INVALID_REQUEST, 'invalid size policy');
    }
    const stagedId = randomUUID();
    const objectKey = `staged/${stagedId}.bin`; // server-chosen; never caller-chosen
    this.#safePath(objectKey); // traversal guard
    await mkdir(dirname(resolve(this.rootDir, objectKey)), { recursive: true });
    const expiresAt = new Date(Date.now() + this.urlTtlSeconds * 1000).toISOString();
    return { stagedId, uploadUrl: resolve(this.rootDir, objectKey), objectKey, expiresAt };
  }

  /** Verifies checksum + byte count only — never inspects content (BE-MINT-005). */
  async finalizeStagedObject(stagedId, objectKey, input) {
    const absolute = this.#safePath(objectKey);
    let info;
    try {
      info = await stat(absolute);
    } catch {
      throw new DomainError(ErrorCode.STORAGE_FINALIZATION_FAILED, 'staged object missing');
    }
    if (info.size !== input.expectedByteSize) {
      throw new DomainError(ErrorCode.STORAGE_FINALIZATION_FAILED, 'byte size mismatch');
    }
    const checksum = await this.#sha256File(absolute);
    if (checksum !== String(input.expectedChecksumSha256).toLowerCase()) {
      throw new DomainError(ErrorCode.STORAGE_FINALIZATION_FAILED, 'checksum mismatch');
    }
  }

  async createDownloadIntent(objectKey) {
    const absolute = this.#safePath(objectKey);
    try {
      await stat(absolute);
    } catch {
      throw new DomainError(ErrorCode.DOCUMENT_NOT_READY, 'object unavailable');
    }
    const expiresAt = new Date(Date.now() + this.urlTtlSeconds * 1000).toISOString();
    const token = createHash('sha256').update(`${absolute}|${expiresAt}`).digest('hex').slice(0, 32);
    return { downloadUrl: `${absolute}?token=${token}&expires=${expiresAt}`, expiresAt };
  }

  async deleteStaged(objectKey) {
    try {
      await unlink(this.#safePath(objectKey));
    } catch {
      /* already gone */
    }
  }

  async writeObject(objectKey, data) {
    const absolute = this.#safePath(objectKey);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, data);
  }

  #safePath(objectKey) {
    const absolute = resolve(this.rootDir, objectKey);
    if (!absolute.startsWith(this.rootDir)) {
      throw new DomainError(ErrorCode.INVALID_REQUEST, 'path traversal denied');
    }
    return absolute;
  }

  #sha256File(path) {
    return new Promise((res, rej) => {
      const hash = createHash('sha256');
      createReadStream(path)
        .on('data', (d) => hash.update(d))
        .on('error', rej)
        .on('end', () => res(hash.digest('hex')));
    });
  }
}
