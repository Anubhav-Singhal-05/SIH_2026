// Rollback-safe deployment procedure (documented, forward-only — never auto-executed): the
// collection group created here is rebuildable from provider archive logs from the deployment
// block; if this migration must be abandoned post-deploy, gate writes via the indexer feature
// flag and drop the created collections in a maintenance window.
﻿// Migration 0006 â€” merkle domain: merkle_root_versions, merkle_leaf_snapshots.
// Index impact: unique (did_hash, version); unique (did_hash, root_version,
// asset_id) AND unique (did_hash, root_version, ordinal).

import { ensureCollection } from '../src/schema/index.js';

export const description = 'create merkle domain collections (merkle_root_versions, merkle_leaf_snapshots)';
export const indexImpact = 'adds unique (did_hash, version), unique (did_hash, root_version, asset_id), unique (did_hash, root_version, ordinal)';

export async function up(db) {
  await ensureCollection(db, 'merkle_root_versions');
  await ensureCollection(db, 'merkle_leaf_snapshots');
}

