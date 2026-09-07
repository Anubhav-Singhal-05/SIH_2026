// Rollback-safe deployment procedure (documented, forward-only — never auto-executed): the
// collection group created here is rebuildable from provider archive logs from the deployment
// block; if this migration must be abandoned post-deploy, gate writes via the indexer feature
// flag and drop the created collections in a maintenance window.
﻿// Migration 0003 â€” asset domain: assets, asset_ownership_history,
// asset_metadata, document_versions.
// Index impact: unique asset_id; owner+status / status+version; history unique
// event key + (asset_id, occurred_at desc); document_versions unique
// (asset_id, version) + (asset_id, version desc).

import { ensureCollection } from '../src/schema/index.js';

export const description = 'create asset domain collections (assets, asset_ownership_history, asset_metadata, document_versions)';
export const indexImpact = 'adds unique asset_id, ix owner+status, ix status+version, unique event key, ix (asset_id, occurred_at desc), unique (asset_id, version), ix (asset_id, version desc)';

export async function up(db) {
  await ensureCollection(db, 'assets');
  await ensureCollection(db, 'asset_ownership_history');
  await ensureCollection(db, 'asset_metadata');
  await ensureCollection(db, 'document_versions');
}

