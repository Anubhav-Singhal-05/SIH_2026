// Merkle tree primitives — the SOLE legal algorithm implementation.
// Frozen specification (see database_team_spec.md §6):
//
//   leaf   = SHA256(0x00 || assetId[32] || ownerDidHash[32] || documentHash[32] ||
//                   metadataHash[32] || documentVersion[8])
//   parent = SHA256(0x01 || left[32] || right[32])
//   EMPTY_ROOT = SHA256(0x02)
//
// - Leaves are strictly ascending by unsigned 256-bit asset id.
// - A final odd node duplicates itself at each level.
// - A single leaf is the root. Empty state is EMPTY_ROOT.

import { createHash } from 'node:crypto';

export const LEAF_PREFIX = Buffer.from([0x00]);
export const PARENT_PREFIX = Buffer.from([0x01]);
export const EMPTY_ROOT_INPUT = Buffer.from([0x02]);

export function sha256(buf) {
  return createHash('sha256').update(buf).digest();
}

/** 0x-prefixed, 66-char, lower-case hex string. */
export function toHex32(buf) {
  return '0x' + Buffer.from(buf).toString('hex').toLowerCase().padStart(64, '0');
}

/** Parse a bytes32 hex string; accepts any case, requires 0x + 64 hex chars. */
export function parseHex32(hex) {
  if (typeof hex !== 'string') throw new TypeError(`bytes32 must be a hex string, got ${typeof hex}`);
  const s = hex.toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(s)) {
    throw new TypeError(`bytes32 must be 0x-prefixed 64 hex chars: ${hex}`);
  }
  return Buffer.from(s.slice(2), 'hex');
}

/** Normalize to the canonical 0x-prefixed 66-char lower-case form. */
export function normalizeHex32(hex) {
  return toHex32(parseHex32(hex));
}

function beUint(v, width) {
  const out = Buffer.alloc(width);
  for (let i = width - 1; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/**
 * Encode an unsigned 256-bit asset id as 32 bytes big-endian.
 * Accepts bigint or a decimal string (bigint-backed: no precision loss for max uint256).
 */
export function encodeUint256(assetId) {
  let v;
  if (typeof assetId === 'bigint') v = assetId;
  else if (typeof assetId === 'string' && /^-?\d+$/.test(assetId)) v = BigInt(assetId);
  else if (Number.isSafeInteger(assetId)) v = BigInt(assetId);
  else throw new TypeError(`asset id must be bigint or decimal string, got ${typeof assetId}`);
  if (v < 0n || v >= 1n << 256n) throw new RangeError(`asset id out of uint256 range: ${v}`);
  const buf = Buffer.alloc(32);
  buf.set(beUint(v & 0xffffffffffffffffn, 8), 24);
  let rest = v >> 64n;
  buf.set(beUint(rest & 0xffffffffffffffffn, 8), 16);
  rest >>= 64n;
  buf.set(beUint(rest & 0xffffffffffffffffn, 8), 8);
  buf.set(beUint(rest >> 64n, 8), 0);
  return buf;
}

/** Encode an unsigned 64-bit document version as 8 bytes big-endian. */
export function encodeUint64(version) {
  const v = typeof version === 'bigint' ? version : BigInt(version);
  if (v < 0n || v >= 1n << 64n) throw new RangeError(`version out of uint64 range: ${v}`);
  return beUint(v, 8);
}

/**
 * Deterministic Merkle leaf.
 * @param {{assetId: bigint|string, ownerDidHash: string, documentHash: string,
 *          metadataHash: string, documentVersion: bigint|string|number}} leafInput
 * @returns {string} 0x-prefixed 66-char lower-case hex leaf hash
 */
export function merkleLeaf({ assetId, ownerDidHash, documentHash, metadataHash, documentVersion }) {
  return toHex32(
    sha256(
      Buffer.concat([
        LEAF_PREFIX,
        encodeUint256(assetId),
        parseHex32(ownerDidHash),
        parseHex32(documentHash),
        parseHex32(metadataHash),
        encodeUint64(documentVersion),
      ]),
    ),
  );
}

/** parent = SHA256(0x01 || left || right) */
export function merkleParent(left, right) {
  return toHex32(sha256(Buffer.concat([PARENT_PREFIX, parseHex32(left), parseHex32(right)])));
}

/** EMPTY_ROOT = SHA256(0x02) */
export function emptyRoot() {
  return toHex32(sha256(EMPTY_ROOT_INPUT));
}

function toBig(x) {
  return typeof x === 'bigint' ? x : BigInt(x);
}

/**
 * Build the root for an ordered list of leaf hashes.
 * Leaves must already be strictly ascending by unsigned 256-bit asset id.
 * @param {string[]} leaves
 * @returns {{root: string, levels: string[][]}} levels[0] is the leaf level.
 */
export function buildTree(leaves) {
  if (leaves.length === 0) {
    return { root: emptyRoot(), levels: [] };
  }
  let level = leaves.slice();
  const levels = [level];
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      // A final odd node duplicates itself.
      const right = i + 1 < level.length ? level[i + 1] : left;
      next.push(merkleParent(left, right));
    }
    level = next;
    levels.push(level);
  }
  return { root: level[0], levels };
}

/**
 * Assert (assetId, leafHash) entries are strictly ascending by unsigned
 * 256-bit asset id.
 */
export function assertOrdered(entries) {
  for (let i = 1; i < entries.length; i++) {
    const a = toBig(entries[i - 1].assetId);
    const b = toBig(entries[i].assetId);
    if (!(a < b)) {
      throw new Error(`leaf order violation: asset ids must be strictly ascending (index ${i - 1} -> ${i})`);
    }
  }
}

/**
 * Generate a Merkle proof for the leaf at `ordinal` (position among leaves
 * ascending by asset id). Works for odd counts: when a node is last in an
 * odd level, its (duplicated) sibling is itself.
 */
export function generateProof(leaves, ordinal) {
  if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= leaves.length) {
    throw new RangeError(`ordinal ${ordinal} out of range for ${leaves.length} leaves`);
  }
  const { levels } = buildTree(leaves);
  const siblings = [];
  let index = ordinal;
  for (let l = 0; l < levels.length - 1; l++) {
    const level = levels[l];
    const sibIndex = index % 2 === 1 ? index - 1 : index + 1;
    // odd final node duplicates itself
    siblings.push(level[Math.min(sibIndex, level.length - 1)]);
    index = Math.floor(index / 2);
  }
  return { leaf: leaves[ordinal], ordinal, siblings };
}

/**
 * Verify a proof against a root. Recomputes leaf -> root using the frozen
 * formula; sibling direction at each level is inferred from the running
 * ordinal, exactly mirroring generateProof.
 */
export function verifyProof({ leaf, ordinal, siblings, root }) {
  let hash = leaf;
  let index = ordinal;
  for (const sibling of siblings) {
    hash = index % 2 === 1 ? merkleParent(sibling, hash) : merkleParent(hash, sibling);
    index = Math.floor(index / 2);
  }
  return hash === root;
}

/** Compute the root from (assetId, leafHash) entries; sorts ascending by asset id. */
export function computeRoot(entries) {
  if (!Array.isArray(entries)) throw new TypeError('entries must be an array');
  if (entries.length === 0) return emptyRoot();
  const sorted = entries
    .map((e) => ({ assetId: toBig(e.assetId), leafHash: e.leafHash ?? e.leaf ?? e.leaf_hash }))
    .sort((a, b) => (a.assetId < b.assetId ? -1 : a.assetId > b.assetId ? 1 : 0));
  return buildTree(sorted.map((e) => e.leafHash)).root;
}
