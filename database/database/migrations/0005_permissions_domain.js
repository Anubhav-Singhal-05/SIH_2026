// Rollback-safe deployment procedure (documented, forward-only — never auto-executed): the
// collection group created here is rebuildable from provider archive logs from the deployment
// block; if this migration must be abandoned post-deploy, gate writes via the indexer feature
// flag and drop the created collections in a maintenance window.
﻿// Migration 0005 â€” permissions domain: asset_permissions, permission_history.
// Index impact: partial-unique active (asset_id, grantee_did_hash), ix
// (asset_id, grantee_did_hash, active), partial expiry index; history unique
// event key + (asset_id, occurred_at desc).

import { ensureCollection } from '../src/schema/index.js';

export const description = 'create permissions domain collections (asset_permissions, permission_history)';
export const indexImpact = 'adds partial-unique active (asset_id, grantee), ix (asset, grantee, active), partial expiry index, unique event key, ix (asset_id, occurred_at desc)';

export async function up(db) {
  await ensureCollection(db, 'asset_permissions');
  await ensureCollection(db, 'permission_history');
}

