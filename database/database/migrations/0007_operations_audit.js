// Rollback-safe deployment procedure (documented, forward-only — never auto-executed): the
// collection group created here is rebuildable from provider archive logs from the deployment
// block; if this migration must be abandoned post-deploy, gate writes via the indexer feature
// flag and drop the created collections in a maintenance window.
﻿// Migration 0007 â€” operations and audit: operations, audit_events.
// Index impact: unique (caller_did_hash, idempotency_key), ix
// (caller_did_hash, created_at desc), sparse tx-hash index; audit time index
// and sparse correlation index.

import { ensureCollection } from '../src/schema/index.js';

export const description = 'create operations and audit collections (operations, audit_events)';
export const indexImpact = 'adds unique (caller, idempotency_key), ix (caller, created_at desc), sparse tx index, ix audit time, sparse correlation index';

export async function up(db) {
  await ensureCollection(db, 'operations');
  await ensureCollection(db, 'audit_events');
}

