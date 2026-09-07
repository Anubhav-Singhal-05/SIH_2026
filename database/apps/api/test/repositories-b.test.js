// Repository suite B (§7): roots, optimistic operation transitions, audit.

import test from 'node:test';
import assert from 'node:assert/strict';
import { withEphemeralDb, H, OWNER, GRANTEE } from './harness.js';
import { RootRepository, OperationRepository, AuditRepository } from '../src/infrastructure/repositories/ops.js';
import { normalizeHex32 } from '@sih/protocol';

test('RootRepository getCurrent/getVersion', async () => {
  await withEphemeralDb(async (db) => {
    const did = normalizeHex32(OWNER);
    await db.collection('merkle_root_versions').insertOne({ did_hash: did, version: 1, root: H(0xc1), operation_hash: H(0xd1), block_number: 10, tx_hash: H(0xa1), finalized: true });
    await db.collection('merkle_root_versions').insertOne({ did_hash: did, version: 2, root: H(0xc2), operation_hash: H(0xd2), block_number: 20, tx_hash: H(0xa2), finalized: true });
    const repo = new RootRepository(db);
    assert.equal((await repo.getCurrent(OWNER)).version, 2);
    assert.equal((await repo.getVersion(OWNER, 1)).root, H(0xc1));
    assert.equal(await repo.getVersion(OWNER, 9), null);
    // provisional roots are never exposed as current
    await db.collection('merkle_root_versions').insertOne({ did_hash: did, version: 3, root: H(0xc3), operation_hash: H(0xd3), block_number: 30, tx_hash: H(0xa3), finalized: false });
    assert.equal((await repo.getCurrent(OWNER)).version, 2);
  });
});

test('OperationRepository.transition enforces optimistic concurrency', async () => {
  await withEphemeralDb(async (db) => {
    const repo = new OperationRepository(db);
    const op = await repo.create({ callerDidHash: OWNER, idempotencyKey: 'idem-1', requestHash: H(0x01), type: 'mint' });
    assert.equal((await repo.findByIdempotency(OWNER, 'idem-1')).id, op.id);
    assert.ok(await repo.transition(op.id, 'PENDING', 'SUBMITTED')); // correct expected status
    assert.equal(await repo.transition(op.id, 'PENDING', 'CONFIRMED'), null); // mismatch -> null
    assert.equal((await repo.findByIdempotency(OWNER, 'idem-1')).status, 'SUBMITTED');
  });
});

test('AuditRepository: append-only, app vs chain distinguishable', async () => {
  await withEphemeralDb(async (db) => {
    const repo = new AuditRepository(db);
    const app = await repo.append({ actorDidHash: OWNER, action: 'intent.prepare_mint', targetType: 'asset', targetId: '10', payload: { root: H(0xc1) } });
    const chain = await repo.appendChain({ action: 'chain.AssetRegistered', targetType: 'asset', targetId: '10', correlationId: app.id, payload: { tx: H(0xa1) } });
    assert.equal(app.source, 'app');
    assert.equal(chain.source, 'chain');
    // append-only: no update/delete paths exist on the repository
    assert.equal(typeof repo.update, 'undefined');
    assert.equal(typeof repo.delete, 'undefined');
    assert.equal(typeof repo.replace, 'undefined');
    const list = await repo.list({ targetType: 'asset', targetId: '10' });
    assert.equal(list.items.length, 2);
  });
});
