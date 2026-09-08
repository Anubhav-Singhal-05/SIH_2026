// UUIDv7 generator (application-generated primary keys per spec §4).
// 48-bit unix ms timestamp + 4-bit version(7) + random.

import { randomBytes } from 'node:crypto';

export function uuidv7(now = Date.now()) {
  // JS bitwise ops are 32-bit signed — use an arithmetic mask for the 48-bit ts.
  const ts48 = now % 281474976710656; // 2**48
  const ts = Buffer.alloc(6);
  ts.writeUIntBE(ts48, 0, 6);
  const rand = randomBytes(10);
  const bytes = Buffer.concat([ts, rand]);
  bytes[6] = ((bytes[6] & 0x0f) | 0x70); // version 7
  bytes[8] = ((bytes[8] & 0x3f) | 0x80); // RFC variant
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function isUuidv7(s) {
  if (typeof s !== 'string') return false;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(s)) return false;
  const ts = Buffer.from(s.replace(/-/g, '').slice(0, 12), 'hex').readUIntBE(0, 6);
  return ts > 0;
}
