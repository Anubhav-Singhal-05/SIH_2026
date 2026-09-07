// Migration 0009 — relax primary-key `id` pattern to also accept the dummy
// population `PREFIX0001` form (one bounded concern: the id pattern).
// Index impact: none.
//
// Rollback-safe deployment procedure (documented, forward-only — never
// auto-executed): re-apply the stricter UUID-only validator from migrations
// 0002..0008 in a maintenance window after confirming no dummy-population
// rows exist.

import { ensureCollection } from '../src/schema/index.js';

export const description = 'relax id pattern: accept UUIDv7 or dummy-population PREFIX0001 ids';
export const indexImpact = 'none (validator-only change; indexes untouched)';

const ID_COLLECTIONS = [
  'identities', 'identity_keys', 'webauthn_credentials',
  'asset_ownership_history', 'document_versions', 'storage_objects',
  'document_key_envelopes', 'permission_history', 'operations',
  'audit_events', 'inheritance_cases',
];

export async function up(db) {
  for (const name of ID_COLLECTIONS) {
    await ensureCollection(db, name, { skipIndexes: true });
  }
}
