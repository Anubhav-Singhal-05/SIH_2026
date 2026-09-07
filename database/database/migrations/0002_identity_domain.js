// Rollback-safe deployment procedure (documented, forward-only — never auto-executed): the
// collection group created here is rebuildable from provider archive logs from the deployment
// block; if this migration must be abandoned post-deploy, gate writes via the indexer feature
// flag and drop the created collections in a maintenance window.
﻿// Migration 0002 â€” identity domain: identities, identity_keys,
// webauthn_credentials, sessions, platform_roles.
// Index impact: unique did/did_hash, unique active controller, unique active
// encryption key per identity, unique credential_id/refresh_hash, unique
// active role per DID/role.

import { ensureCollection } from '../src/schema/index.js';

export const description = 'create identity domain collections (identities, identity_keys, webauthn_credentials, sessions, platform_roles)';
export const indexImpact = 'adds unique did, did_hash, partial-unique active controller, partial-unique active encryption key per identity, unique credential_id, unique refresh_hash, partial-unique active role';

export async function up(db) {
  await ensureCollection(db, 'identities');
  await ensureCollection(db, 'identity_keys');
  await ensureCollection(db, 'webauthn_credentials');
  await ensureCollection(db, 'sessions');
  await ensureCollection(db, 'platform_roles');
}

