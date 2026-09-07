// DB-SCHEMA-001..011 â€” migrations + identity-domain constraints.
// Runs against an EPHEMERAL Atlas database created/dropped per run.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createEphemeralDb } from '../src/test-util.js';
import { COLLECTIONS, ALL_VALIDATORS } from '../src/schema/index.js';
import { fixture, H1, H2, H3 } from '../fixtures/fixtures.js';
import { uuidv7 } from '../src/uuid7.js';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const state = {};
test.before(async () => {
  const eph = await createEphemeralDb();
  state.db = eph.db; state.applied = eph.applied; state.cleanup = eph.cleanup;
});
test.after(async (t) => { await state.cleanup(); });

test('DB-SCHEMA-001: all migrations apply cleanly to an empty database', (t) => {
  const { applied } = state;
  assert.equal(applied.length, 9);
  assert.ok(applied.every((id) => /^\d{4}_/.test(id)));
  assert.equal(COLLECTIONS.length, 22);
  assert.equal(Object.keys(ALL_VALIDATORS).length, 22);
});

test('DB-SCHEMA-002: migrations apply cleanly on top of a prior-release snapshot (idempotent re-run)', async (t) => {
  const { db } = state;
  const before = (await db.listCollections().toArray()).length;
  const { migrateUp } = await import('../src/migrate.js');
  const again = await migrateUp(db);
  assert.equal(again.length, 0); // nothing re-applied on an already-migrated DB
  const after = (await db.listCollections().toArray()).length;
  assert.equal(before, after);
});

test('DB-SCHEMA-003/004: forward-only, documented rollback procedure + index impact', async () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.js')).sort();
  assert.equal(files.length, 9);
  for (const f of files) {
    const src = await readFile(path.join(dir, f), 'utf8');
    assert.match(src, /export const description/, `${f} documents its concern`);
    assert.match(src, /export const indexImpact/, `${f} documents index impact`);
    assert.match(src, /Rollback-safe deployment procedure/, `${f} documents rollback-safe procedure`);
    assert.doesNotMatch(src, /export async function down/, `${f} must be forward-only (no executable down())`);
  }
});

test('DB-SCHEMA-005: application code never attempts schema changes at startup (static audit)', async () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const forbidden = /createCollection|collMod|createIndexes|ensureCollection/;
  const allowed = /[\\/](migrations|schema|scripts|roles|database[\\/]src|test|node_modules)[\\/]/;
  const { readdirSync } = await import('node:fs');
  const walk = (dir) => {
    let out = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name.startsWith('.') || e.name.endsWith('.log')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) out = out.concat(walk(p));
      else if (e.name.endsWith('.js')) out.push(p);
    }
    return out;
  };
  for (const file of walk(root)) {
    if (allowed.test(file)) continue;
    const src = await readFile(file, 'utf8');
    assert.doesNotMatch(src, forbidden, `app file must not change schema: ${file}`);
  }
});

test('DB-SCHEMA-006: identities.did / did_hash unique â€” duplicate insert fails', async (t) => {
  const { db } = state;
  const c = db.collection('identities');
  await c.insertOne(fixture.identity());
  await assert.rejects(() => c.insertOne(fixture.identity({ id: uuidv7(), controller: 'x2' })), /duplicate|E11000/i);
  await assert.rejects(
    () => c.insertOne(fixture.identity({ id: uuidv7(), did: 'did:sih:cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd', controller: 'x3' })),
    /duplicate|E11000/i,
  );
});

test('DB-SCHEMA-007: controller unique only while active', async (t) => {
  const { db } = state;
  const c = db.collection('identities');
  await c.insertOne(fixture.identity({ id: uuidv7(), did: 'did:sih:' + '77'.repeat(32), did_hash: '0x' + '77'.repeat(32), controller: 'ctrl-shared', status: 'suspended' }));
  await c.insertOne(fixture.identity({ id: uuidv7(), did: 'did:sih:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', did_hash: '0x' + 'aa'.repeat(32), controller: 'ctrl-shared' }));
  await assert.rejects(
    () => c.insertOne(fixture.identity({ id: uuidv7(), did: 'did:sih:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', did_hash: '0x' + 'bb'.repeat(32), controller: 'ctrl-shared' })),
    /duplicate|E11000/i,
  );
});

test('DB-SCHEMA-008: exactly one active encryption key per identity', async (t) => {
  const { db } = state;
  const c = db.collection('identity_keys');
  const iid = uuidv7();
  await c.insertOne(fixture.identityKey(iid));
  await assert.rejects(() => c.insertOne(fixture.identityKey(iid, { id: uuidv7() })), /duplicate|E11000/i);
  await c.updateOne({ identity_id: iid }, { $set: { active_to: new Date() } });
  await c.insertOne(fixture.identityKey(iid, { id: uuidv7() }));
  await c.insertOne(fixture.identityKey(iid, { id: uuidv7(), key_type: 'signing' }));
  assert.equal(await c.countDocuments({ identity_id: iid, key_type: 'encryption', active_to: null }), 1);
});

test('DB-SCHEMA-009/010: credential_id and refresh_hash unique', async (t) => {
  const { db } = state;
  const iid = uuidv7();
  const cred = { id: uuidv7(), identity_id: iid, credential_id: 'cred-1', cose_public_key: Buffer.from('pk'), sign_count: 0, transports: [], last_used_at: null };
  await db.collection('webauthn_credentials').insertOne(cred);
  await assert.rejects(() => db.collection('webauthn_credentials').insertOne({ ...cred, id: uuidv7() }), /duplicate|E11000/i);
  const sess = { id: uuidv7(), identity_id: iid, refresh_hash: H1, family_id: uuidv7(), expires_at: new Date(), revoked_at: null, replaced_by: null };
  await db.collection('sessions').insertOne(sess);
  await assert.rejects(() => db.collection('sessions').insertOne({ ...sess, id: uuidv7() }), /duplicate|E11000/i);
});

test('DB-SCHEMA-011: platform_roles â€” unique active role per DID/role; revoke frees slot', async (t) => {
  const { db } = state;
  const c = db.collection('platform_roles');
  await c.insertOne({ did_hash: H1, role: 'auditor', active: true, event_key: 'e1' });
  await assert.rejects(() => c.insertOne({ did_hash: H1, role: 'auditor', active: true, event_key: 'e2' }), /duplicate|E11000/i);
  await c.updateOne({ did_hash: H1, role: 'auditor' }, { $set: { active: false } });
  await c.insertOne({ did_hash: H1, role: 'auditor', active: true, event_key: 'e3' });
  await c.insertOne({ did_hash: H1, role: 'operator', active: true, event_key: 'e4' });
});



