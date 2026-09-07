// TDD tests for the frozen Merkle implementation (§10 "Merkle service":
// golden vectors, ordering, odd-node duplication, roots 0/1/even/odd, proofs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  merkleLeaf,
  merkleParent,
  emptyRoot,
  buildTree,
  computeRoot,
  generateProof,
  verifyProof,
  encodeUint256,
  encodeUint64,
  normalizeHex32,
  parseHex32,
  assertOrdered,
} from '../src/merkle/index.js';

const VECTORS = JSON.parse(
  await readFile(fileURLToPath(new URL('../test-vectors/merkle-vectors.json', import.meta.url)), 'utf8'),
);

const leafInputs = VECTORS.leaf_vectors.map((v) => v.input);
const leaves = VECTORS.leaf_vectors.map((v) => v.leaf);

test('EMPTY_ROOT matches the frozen vector', () => {
  assert.equal(emptyRoot(), VECTORS.empty_root);
  assert.equal(buildTree([]).root, VECTORS.empty_root);
  assert.equal(computeRoot([]), VECTORS.empty_root);
});

test('leaf formula matches golden vectors byte-for-byte', () => {
  for (let i = 0; i < leafInputs.length; i++) {
    assert.equal(merkleLeaf(leafInputs[i]), VECTORS.leaf_vectors[i].leaf);
  }
});

test('leaf encoding is order/precision safe for uint256 extremes', () => {
  // max uint256 asset id must not lose precision (BigInt-backed)
  const max = '115792089237316195423570985008687907853269984665640564039457584007913129639935';
  const buf = encodeUint256(max);
  assert.equal(buf.length, 32);
  assert.ok(buf.every((b) => b === 0xff));
  assert.throws(() => encodeUint256(max + '0'), RangeError); // overflow
  const vbuf = encodeUint64('18446744073709551615');
  assert.ok(vbuf.every((b) => b === 0xff));
});

test('parent formula matches golden tree vectors (even/odd/one)', () => {
  for (const tv of VECTORS.tree_vectors) {
    const { root } = buildTree(tv.leaves);
    assert.equal(root, tv.root, tv.name);
    assert.equal(computeRoot(tv.leaves.map((leafHash, i) => ({ assetId: String(i), leafHash }))), tv.root);
  }
  // single leaf is the root
  assert.equal(buildTree([leaves[0]]).root, leaves[0]);
});

test('odd-node duplication is applied at every level', () => {
  const { levels } = buildTree(leaves); // 3 leaves
  assert.equal(levels[0].length, 3);
  assert.equal(levels[1].length, 2);
  // level 1 last node duplicates itself: P(l0,l1) and P(l2,l2)
  const l2d = merkleParent(leaves[2], leaves[2]);
  assert.equal(levels[1][1], l2d);
  // 5 leaves: odd duplication at two consecutive levels
  const five = [...leaves, leaves[0], leaves[1]];
  const fiveLevels = buildTree(five).levels;
  assert.equal(fiveLevels[1][2], merkleParent(leaves[1], leaves[1]));
  assert.equal(fiveLevels[2][1], merkleParent(fiveLevels[1][2], fiveLevels[1][2]));
});

test('leaf ordering is enforced strictly ascending by asset id', () => {
  assert.throws(() => assertOrdered([{ assetId: '5' }, { assetId: '3' }]), /strictly ascending/);
  assert.throws(() => assertOrdered([{ assetId: '5' }, { assetId: '5' }]), /strictly ascending/);
  assert.doesNotThrow(() => assertOrdered([{ assetId: '3' }, { assetId: '5' }]));
});

test('generateProof correct for 1, even, odd leaf counts', () => {
  for (const count of [1, 2, 3, 4, 5, 7]) {
    const ls = [];
    for (let i = 0; i < count; i++) ls.push(merkleLeaf({ ...leafInputs[0], assetId: String(i * 2 + 1) }));
    const root = buildTree(ls).root;
    for (let ord = 0; ord < count; ord++) {
      const proof = generateProof(ls, ord);
      assert.equal(proof.leaf, ls[ord]);
      assert.ok(verifyProof({ ...proof, root }), `proof ${ord}/${count}`);
    }
  }
});

test('single-leaf proof has empty sibling list and verifies', () => {
  const proof = generateProof([leaves[0]], 0);
  assert.deepEqual(proof.siblings, []);
  assert.ok(verifyProof({ ...proof, root: leaves[0] }));
});

test('verifyProof rejects altered sibling, altered leaf, wrong root version', () => {
  const ls = [...leaves, leaves[0], leaves[1]];
  const root = buildTree(ls).root;
  const proof = generateProof(ls, 1);
  // altered sibling
  const badSib = { ...proof, siblings: [leaves[2], ...proof.siblings.slice(1)] };
  assert.equal(verifyProof({ ...badSib, root }), false);
  // altered leaf
  assert.equal(verifyProof({ ...proof, leaf: leaves[0], root }), false);
  // wrong root version
  assert.equal(verifyProof({ ...proof, root: VECTORS.empty_root }), false);
});

test('bytes32 normalization: consistent 0x-prefixed 66-char lower-case hex', () => {
  const mixed = '0x' + 'AB'.repeat(32);
  assert.equal(normalizeHex32(mixed), '0x' + 'ab'.repeat(32));
  assert.equal(normalizeHex32(mixed).length, 66);
  assert.throws(() => parseHex32('abc'), TypeError);
  assert.throws(() => parseHex32('0xzz' + '00'.repeat(31)), TypeError);
});
