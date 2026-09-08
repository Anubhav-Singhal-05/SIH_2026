import { DomainError, ErrorCode } from './errors.js';
import { requestDigest } from './did.js';

/** Idempotency store (BE-PIPE-007..010); fixture for the database repository. */
export class IdempotencyRepository {
  constructor(ttlSeconds) {
    this.ttlSeconds = ttlSeconds;
    this.records = new Map();
  }

  #key(callerDidHash, key) {
    return `${callerDidHash}|${key}`;
  }

  reserve(callerDidHash, key, endpoint, digest) {
    this.#gc();
    const id = this.#key(callerDidHash, key);
    const existing = this.records.get(id);
    if (existing) {
      if (existing.requestDigest !== digest) {
        throw new DomainError(ErrorCode.IDEMPOTENCY_CONFLICT, 'idempotency key reused with different request');
      }
      return existing;
    }
    const record = { key, callerDidHash, endpoint, requestDigest: digest, createdAt: Date.now() };
    this.records.set(id, record);
    return record;
  }

  complete(record, statusCode, responseBody) {
    record.statusCode = statusCode;
    record.responseBody = responseBody;
  }

  #gc() {
    const cutoff = Date.now() - this.ttlSeconds * 1000;
    for (const [id, rec] of this.records) {
      if (rec.createdAt <= cutoff) this.records.delete(id);
    }
  }
}

export function digestFor(method, path, body) {
  return requestDigest(method, path, body);
}
