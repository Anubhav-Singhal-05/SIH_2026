// Rollback-safe deployment procedure (documented, forward-only — never auto-executed): the
// collection group created here is rebuildable from provider archive logs from the deployment
// block; if this migration must be abandoned post-deploy, gate writes via the indexer feature
// flag and drop the created collections in a maintenance window.
﻿// Migration 0008 â€” inheritance domain: inheritance_rules,
// inheritance_asset_rules, inheritance_cases.
// Index impact: unique owner_did_hash; unique (owner_did_hash, asset_id);
// ix (owner_did_hash, status).

import { ensureCollection } from '../src/schema/index.js';

export const description = 'create inheritance domain collections (inheritance_rules, inheritance_asset_rules, inheritance_cases)';
export const indexImpact = 'adds unique owner_did_hash, unique (owner_did_hash, asset_id), ix (owner_did_hash, status)';

export async function up(db) {
  await ensureCollection(db, 'inheritance_rules');
  await ensureCollection(db, 'inheritance_asset_rules');
  await ensureCollection(db, 'inheritance_cases');
}

