import { createHash } from 'node:crypto';
import { keccak256, toHex } from 'viem';

/**
 * DID normalization + hashing (BE-PIPE-005, INT-FREEZE-002).
 * Normalized DID: trimmed, lower-cased. didHash = keccak256(utf8 bytes).
 */
export function normalizeDid(did) {
  const trimmed = String(did).trim().toLowerCase();
  if (!/^did:[a-z0-9]+:[a-z0-9._%-]+$/.test(trimmed)) throw new Error('invalid DID syntax');
  return trimmed;
}

export function didHash(did) {
  return keccak256(toHex(normalizeDid(did)));
}

/** bytes32 normalization (DB-SCHEMA-023 analog). */
export function normalizeBytes32(value) {
  const v = String(value).toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(v)) throw new Error('invalid bytes32');
  return v;
}
export const normalizeHex32 = normalizeBytes32;

/** Canonical request digest for idempotency (BE-PIPE-008/009). */
export function requestDigest(method, path, body) {
  return createHash('sha256')
    .update(`${method.toUpperCase()}|${path}|${JSON.stringify(body ?? null)}`)
    .digest('hex');
}
