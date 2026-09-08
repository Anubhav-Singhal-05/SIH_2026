// Cross-module integration: backend <-> database module.
// 1. INT-FREEZE-003: backend Merkle implementation must be byte-identical to
//    the database team's frozen @sih/protocol implementation.
// 2. DB round-trip: persist operation + audit + identity projection through
//    the real Atlas database via @sih/database (skips if Atlas is offline).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EMPTY_ROOT as BE_EMPTY_ROOT, leaf as beLeaf, parent as beParent, rootOf as beRootOf } from '../src/merkle.js';
import { didHash as computeDidHash, requestDigest } from '../src/did.js';
import { IdempotencyRepository } from '../src/idempotency.js';
import { DomainError, ErrorCode } from '../src/errors.js';

const require = createRequire(import.meta.url);
const protocol = require('../../database/packages/protocol/src/index.js');

const ATLAS_UP = await (async () => {
  try {
    const { connectionConfig } = require('../../database/database/src/env.js');
    const cfg = connectionConfig();
    const { MongoClient } = require('../../database/node_modules/mongodb');
    const c = new MongoClient(cfg.mongoUri, { serverSelectionTimeoutMS: 8000 });
    await c.db(cfg.dbName).command({ ping: 1 });
    await c.close();
    return true;
  } catch {
    return false;
  }
})();

// ---------------------------------------------------------------------------
// INT-FREEZE-003: cross-language Merkle golden vectors
// ---------------------------------------------------------------------------
const V = {
  assetId: 123456789012345678901234567890n,
  owner: '0x' + 'a1'.repeat(32),
  doc: '0x' + 'b2'.repeat(32),
  meta: '0x' + 'c3'.repeat(32),
  version: 7n,
};

test('INT-BE-DB-001: EMPTY_ROOT identical (backend vs @sih/protocol)', () => {
  assert.equal(BE_EMPTY_ROOT, protocol.emptyRoot());
});

test('INT-BE-DB-002: leaf identical for a golden vector asset', () => {
  const dbLeaf = protocol.merkleLeaf({
    assetId: V.assetId,
    ownerDidHash: V.owner,
    documentHash: V.doc,
    metadataHash: V.meta,
    documentVersion: V.version,
  });
  assert.equal(beLeaf(V.assetId, V.owner, V.doc, V.meta, V.version), dbLeaf);
});

test('INT-BE-DB-003: parent folding identical', () => {
  const a = beLeaf(1n, V.owner, V.doc, V.meta, 1n);
  const b = beLeaf(2n, V.owner, V.doc, V.meta, 1n);
  assert.equal(beParent(a, b), protocol.merkleParent(a, b));
});

test('INT-BE-DB-004: multi-leaf tree root identical (4 leaves, ascending order)', () => {
  const leaves = [1n, 2n, 3n, 5n].map((id) => beLeaf(BigInt(id), V.owner, V.doc, V.meta, 1n));
  const beRoot = beRootOf(leaves);
  const { root: dbRoot } = protocol.buildTree(leaves);
  assert.equal(beRoot, dbRoot);
  // And the database proof system round-trips against the same root.
  const proof = protocol.generateProof(leaves, 2);
  assert.equal(protocol.verifyProof({ leaf: leaves[2], ordinal: 2, siblings: proof.siblings, root: dbRoot }), true);
});

test('INT-BE-DB-005: DID hashing + bytes32 normalization canonical across modules', () => {
  const h = computeDidHash('did:platform:cross-check');
  assert.match(h, /^0x[0-9a-f]{64}$/);
  assert.equal(protocol.toHex32(protocol.parseHex32(h)), h);
});

// ---------------------------------------------------------------------------
// Atlas persistence round-trip (skips automatically if Atlas is offline)
// ---------------------------------------------------------------------------
test('INT-BE-DB-006: operation + audit + identity projection round-trip through Atlas', { skip: !ATLAS_UP }, async () => {
  const { connectionConfig } = require('../../database/database/src/env.js');
  const cfg = connectionConfig();
  const { MongoClient } = require('../../database/node_modules/mongodb');
  const dbName = cfg.dbName + '_integration_tmp';
  const client = new MongoClient(cfg.mongoUri, { serverSelectionTimeoutMS: 15000 });
  await client.connect();
  const db = client.db(dbName);

  try {
    const didHash = computeDidHash('did:platform:db-integration');
    const operationId = crypto.randomUUID();

    // 1. Backend writes an operation record (workflow state).
    await db.collection('operations').insertOne({
      _id: operationId,
      callerDidHash: didHash,
      kind: 'MINT',
      endpoint: 'POST /assets/mint-intent',
      requestDigest: requestDigest('POST', '/assets/mint-intent', { t: 1 }),
      status: 'AWAITING_STEP_UP',
      createdAt: new Date(),
    });

    // 2. Backend writes an audit event (BE-PIPE-012).
    await db.collection('audit_events').insertOne({
      actorDidHash: didHash,
      action: 'mint_intent',
      target: 'asset-1',
      result: 'success',
      at: new Date(),
    });

    // 3. Database team's finalized identity projection.
    await db.collection('identities').insertOne({
      did: 'did:platform:db-integration',
      did_hash: didHash,
      controller: '0xabc',
      status: 'ACTIVE',
    });

    // 4. Idempotency semantics over the backend store (BE-PIPE-008/009).
    const idem = new IdempotencyRepository(3600);
    const d = requestDigest('POST', '/x', { v: 1 });
    const rec = idem.reserve(didHash, 'db-key', '/x', d);
    idem.complete(rec, 200, { persisted: true });
    const replay = idem.reserve(didHash, 'db-key', '/x', d);
    assert.deepEqual(replay.responseBody, { persisted: true });
    assert.throws(
      () => idem.reserve(didHash, 'db-key', '/x', 'other'),
      (e) => e.code === ErrorCode.IDEMPOTENCY_CONFLICT,
    );

    // 5. Read everything back through Atlas.
    const op = await db.collection('operations').findOne({ _id: operationId });
    assert.equal(op.kind, 'MINT');
    const audit = await db.collection('audit_events').findOne({ actorDidHash: didHash });
    assert.equal(audit.action, 'mint_intent');
    const identity = await db.collection('identities').findOne({ did_hash: didHash });
    assert.equal(identity.status, 'ACTIVE');
  } finally {
    await db.dropDatabase().catch(() => {});
    await client.close();
  }
});

test('INT-BE-DB-007: idempotency digest conflict is a typed domain error', () => {
  const idem = new IdempotencyRepository(3600);
  const didHash = computeDidHash('did:platform:x');
  idem.reserve(didHash, 'k', '/x', 'd1');
  assert.throws(
    () => idem.reserve(didHash, 'k', '/x', 'd2'),
    (e) => e instanceof DomainError && e.code === ErrorCode.IDEMPOTENCY_CONFLICT,
  );
});

