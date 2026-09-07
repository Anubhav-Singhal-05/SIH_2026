// Rollback-safe deployment procedure (documented, forward-only — never auto-executed): the
// collection group created here is rebuildable from provider archive logs from the deployment
// block; if this migration must be abandoned post-deploy, gate writes via the indexer feature
// flag and drop the created collections in a maintenance window.
﻿// Migration 0004 â€” storage inventory: storage_objects, document_key_envelopes.
// Stores encrypted object references / opaque blobs only (no plaintext, keys,
// salts, biometrics or recovery material â€” schema audited by tests).
// Index impact: ix document_version_id, ix (state, staged_at), ix
// (document_version_id, recipient_did_hash).

import { ensureCollection } from '../src/schema/index.js';

export const description = 'create storage inventory collections (storage_objects, document_key_envelopes)';
export const indexImpact = 'adds ix document_version_id, ix (state, staged_at), ix (document_version_id, recipient_did_hash)';

export async function up(db) {
  await ensureCollection(db, 'storage_objects');
  await ensureCollection(db, 'document_key_envelopes');
}

