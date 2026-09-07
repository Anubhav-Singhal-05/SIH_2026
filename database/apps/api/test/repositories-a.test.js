// Repository suite A (§7): finalized-only exposure, metadata, pagination,
// permission negatives.

import test from 'node:test';
import assert from 'node:assert/strict';
import { withEphemeralDb, H, OWNER, GRANTEE, ev, makeProvider } from './harness.js';
import { AssetRepository, IdentityRepository } from '../src/infrastructure/repositories/index.js';
import { PermissionRepository } from '../src/infrastructure/repositories/ops.js';
import { runOnce } from '../src/indexer/index.js';
import { loadManifest } from '../src/chain/manifest.js';
import { normalizeHex32 } from '@sih/protocol';

const MANIFEST = loadManifest();

test('IdentityRepository.getFinalizedByDid returns finalized only, with finalization metadata', async () => {
  await withEphemeralDb(async (db, client) => {
    const p = makeProvider([ev.identityRegistered(20)], { blocks: Array.from({ length: 40 }, (_, i) => i + 1) });
    await runOnce(db, client, [p], { manifest: MANIFEST });
    const repo = new IdentityRepository(db);
    const identity = await repo.getFinalizedByDid(OWNER);
    assert.ok(identity);
    assert.equal(identity.projection.finalized, true);
    assert.equal(identity.projection.lastIndexedBlock, 40);
    assert.equal(identity.projection.chainReadRecommended, false);
  });
});

test('AssetRepository list/detail/history: finalized-only, paginated, metadata attached', async () => {
  await withEphemeralDb(async (db, client) => {
    const events = [];
    for (let i = 1; i <= 8; i++) events.push(ev.assetRegistered(i, String(i)));
    const p = makeProvider(events, { blocks: Array.from({ length: 40 }, (_, i) => i + 1) });
    await runOnce(db, client, [p], { manifest: MANIFEST });
    const repo = new AssetRepository(db);
    const list = await repo.getAuthorizedList({ ownerDidHash: OWNER, limit: 3 });
    assert.equal(list.items.length, 3);
    assert.ok(list.hasMore);
    assert.ok(list.nextCursor);
    assert.equal(list.lastIndexedBlock, 40);
    const page2 = await repo.getAuthorizedList({ ownerDidHash: OWNER, limit: 3, cursor: list.nextCursor });
    const ids = new Set([...list.items, ...page2.items].map((a) => a.asset_id));
    assert.equal(ids.size, 6); // cursor pages do not overlap
    const asset = await repo.getFinalizedAsset('2');
    assert.equal(asset.asset_id, '2');
    assert.equal(asset.projection.finalized, true);
    assert.equal(await repo.getFinalizedAsset('9999'), null); // not-found negative
    const history = await repo.getOwnershipHistory('1');
    assert.ok(history.items.length >= 1);
    assert.equal(history.lastIndexedBlock, 40);
    assert.equal(await new PermissionRepository(db).getActive('1', GRANTEE), null); // revoked/expired -> null
  });
});

test('PermissionRepository.getActive: active-only, expiry respected, expiry sweep index', async () => {
  await withEphemeralDb(async (db) => {
    await db.collection('asset_permissions').insertOne({
      asset_id: '5', grantee_did_hash: normalizeHex32(GRANTEE), permission_mask: 7,
      expires_at: new Date(Date.now() + 3600_000), active: true, event_key: 'e1', finalized: true,
    });
    await db.collection('asset_permissions').insertOne({
      asset_id: '6', grantee_did_hash: normalizeHex32(GRANTEE), permission_mask: 7,
      expires_at: new Date(Date.now() - 3600_000), active: true, event_key: 'e2', finalized: true,
    });
    const repo = new PermissionRepository(db);
    assert.ok(await repo.getActive('5', GRANTEE));
    assert.equal(await repo.getActive('6', GRANTEE), null); // expired -> null
    assert.equal(await repo.getActive('7', GRANTEE), null); // missing -> null
    assert.equal((await repo.findExpired()).length, 1);
  });
});
