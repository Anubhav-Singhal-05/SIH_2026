import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  ErrorCode,
  DomainError,
  CONTRACT_ERROR_MAP,
  sha256Hex,
  normalizeDid,
  didHash,
  requestDigest,
  EMPTY_ROOT,
  leaf,
  parent,
  rootOf,
  computeOperationHash,
  keccak256,
  toHex,
} from './helpers.js';

test('BE-ERR-001: all 14 stable codes exist with HTTP statuses', () => {
  const codes = [
    'UNAUTHENTICATED', 'FORBIDDEN', 'INVALID_REQUEST', 'IDEMPOTENCY_CONFLICT',
    'STALE_ROOT', 'PERMIT_EXPIRED', 'WRONG_NETWORK', 'CHAIN_UNAVAILABLE',
    'CONTRACT_REVERTED', 'STORAGE_FINALIZATION_FAILED', 'DOCUMENT_NOT_READY',
    'REORG_IN_PROGRESS', 'RATE_LIMITED', 'INTERNAL_ERROR',
  ];
  for (const code of codes) {
    const err = new DomainError(code, 'x');
    assert.equal(err.code, code);
    assert.ok(err.status >= 400 && err.status <= 503);
  }
  assert.equal(Object.keys(ErrorCode).length, 14);
});

test('BE-CHAIN-006: contract custom errors map to domain codes', () => {
  for (const name of ['StaleRoot', 'RootVersionMismatch', 'IdentityNotActive', 'InvalidPermit', 'AssetInactive']) {
    assert.ok(CONTRACT_ERROR_MAP[name], name);
  }
});

test('BE-PIPE-005 / INT-FREEZE-002: DID normalization is canonical', () => {
  assert.equal(normalizeDid(' DID:Platform:AlIcE '), 'did:platform:alice');
  assert.throws(() => normalizeDid('not-a-did'));
  assert.throws(() => normalizeDid('did:'));
  const h = didHash('did:platform:alice');
  assert.match(h, /^0x[0-9a-f]{64}$/);
  assert.equal(didHash('  DID:PLATFORM:ALICE '), h);
});

test('request digest is stable and content-sensitive (BE-PIPE-008/009)', () => {
  assert.equal(requestDigest('POST', '/x', { a: 1 }), requestDigest('post', '/x', { a: 1 }));
  assert.notEqual(requestDigest('POST', '/x', { a: 1 }), requestDigest('POST', '/x', { a: 2 }));
});

test('EMPTY_ROOT = SHA256(0x02) — golden vector', () => {
  assert.equal(EMPTY_ROOT, '0x' + sha256Hex(Buffer.from('02', 'hex')));
});

test('leaf matches the canonical byte layout — golden vector', () => {
  const owner = '0x' + '11'.repeat(32);
  const doc = '0x' + '22'.repeat(32);
  const meta = '0x' + '33'.repeat(32);
  const l = leaf(42n, owner, doc, meta, 1n);
  const input = '00' + '2a'.padStart(64, '0') + owner.slice(2) + doc.slice(2) + meta.slice(2) + '01'.padStart(16, '0');
  assert.equal(l, '0x' + sha256Hex(Buffer.from(input, 'hex')));
});

test('parent folds 0x01 || left || right; odd leaves duplicate', () => {
  const a = '0x' + 'aa'.repeat(32);
  const b = '0x' + 'bb'.repeat(32);
  assert.equal(parent(a, b), '0x' + sha256Hex(Buffer.from('01' + 'aa'.repeat(32) + 'bb'.repeat(32), 'hex')));
  // Three leaves: level 1 = [parent(a,b), parent(a,a)] (odd node duplicated).
  assert.equal(rootOf([a, b, a]), parent(parent(a, b), parent(a, a)));
});

test('BC-DEPLOY-012: operation hash matches the Solidity formula', () => {
  const chainId = 31337n;
  const target = '0x' + '44'.repeat(20);
  const selector = '0x' + '55'.repeat(4);
  const did = '0x' + '66'.repeat(32);
  const args = toHex(new Uint8Array([1, 2, 3]));
  const expected = keccak256(
    '0x' +
      chainId.toString(16).padStart(64, '0') +
      target.slice(2).padStart(64, '0') +
      selector.slice(2).padEnd(64, '0') + // bytesN is LEFT-aligned in ABI encoding
      did.slice(2) +
      5n.toString(16).padStart(64, '0') +
      99n.toString(16).padStart(64, '0') +
      keccak256(args).slice(2),
  );
  assert.equal(computeOperationHash(chainId, target, selector, did, 5n, 99n, args), expected);
});
