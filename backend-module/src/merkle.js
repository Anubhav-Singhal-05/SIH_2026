import { createHash } from 'node:crypto';

export const EMPTY_ROOT = sha256Bytes('02'); // SHA256(0x02)

export function sha256Bytes(hexBytes) {
  const clean = hexBytes.startsWith('0x') ? hexBytes.slice(2) : hexBytes;
  return '0x' + createHash('sha256').update(Buffer.from(clean, 'hex')).digest('hex');
}

/** leaf = SHA256(0x00 || assetId[32] || ownerDid[32] || doc[32] || meta[32] || version[8]) */
export function leaf(assetId, ownerDidHash, documentHash, metadataHash, documentVersion) {
  const input =
    '00' +
    assetId.toString(16).padStart(64, '0') +
    strip(ownerDidHash) +
    strip(documentHash) +
    strip(metadataHash) +
    documentVersion.toString(16).padStart(16, '0');
  return sha256Bytes(input);
}

/** parent = SHA256(0x01 || left[32] || right[32]) */
export function parent(left, right) {
  return sha256Bytes('01' + strip(left) + strip(right));
}

/** Root of ordered leaves; odd final node duplicated; empty tree = EMPTY_ROOT. */
export function rootOf(leaves) {
  if (leaves.length === 0) return EMPTY_ROOT;
  let level = [...leaves];
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const l = level[i];
      const r = i + 1 < level.length ? level[i + 1] : l;
      next.push(parent(l, r));
    }
    level = next;
  }
  return level[0];
}

function strip(hex) {
  return hex.startsWith('0x') ? hex.slice(2) : hex;
}
