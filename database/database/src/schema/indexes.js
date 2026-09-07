// Index definitions per spec §4. Partial unique indexes translate the spec's
// "unique while active" constraints; they tolerate an old record becoming
// inactive immediately followed by a new active record (DB-SCHEMA-016).

export const INDEXES = {
  identities: [
    [{ did: 1 }, { unique: true, name: 'uq_did' }],
    [{ did_hash: 1 }, { unique: true, name: 'uq_did_hash' }],
    [{ controller: 1 }, { unique: true, name: 'uq_controller_active', partialFilterExpression: { status: 'active' } }],
  ],
  identity_keys: [
    // exactly one ACTIVE encryption key per identity
    [{ identity_id: 1 }, { unique: true, name: 'uq_active_encryption_key', partialFilterExpression: { key_type: 'encryption', active_to: null } }],
    [{ identity_id: 1, key_type: 1, active_from: 1 }, { name: 'ix_identity_keys_type' }],
  ],
  webauthn_credentials: [
    [{ credential_id: 1 }, { unique: true, name: 'uq_credential_id' }],
    [{ identity_id: 1 }, { name: 'ix_webauthn_identity' }],
  ],
  sessions: [
    [{ refresh_hash: 1 }, { unique: true, name: 'uq_refresh_hash' }],
    [{ identity_id: 1, expires_at: 1 }, { name: 'ix_sessions_identity' }],
  ],
  platform_roles: [
    // unique ACTIVE role record per DID/role (revoked rows free the slot)
    [{ did_hash: 1, role: 1 }, { unique: true, name: 'uq_active_role', partialFilterExpression: { active: true } }],
    [{ did_hash: 1 }, { name: 'ix_platform_roles_did' }],
  ],
  assets: [
    [{ asset_id: 1 }, { unique: true, name: 'uq_asset_id' }],
    [{ owner_did_hash: 1, status: 1 }, { name: 'ix_assets_owner_status' }],
    [{ status: 1, current_version: 1 }, { name: 'ix_assets_status_version' }],
  ],
  asset_ownership_history: [
    [{ event_key: 1 }, { unique: true, name: 'uq_event_key' }],
    [{ asset_id: 1, occurred_at: -1 }, { name: 'ix_history_asset_time_desc' }],
  ],
  asset_metadata: [
    [{ asset_id: 1, created_at: -1 }, { name: 'ix_asset_metadata_asset' }],
  ],
  document_versions: [
    [{ asset_id: 1, version: 1 }, { unique: true, name: 'uq_asset_version' }],
    [{ asset_id: 1, version: -1 }, { name: 'ix_versions_asset_version_desc' }],
  ],
  storage_objects: [
    [{ document_version_id: 1 }, { name: 'ix_storage_objects_version' }],
    [{ state: 1, staged_at: 1 }, { name: 'ix_storage_objects_state_staged' }],
  ],
  document_key_envelopes: [
    [{ document_version_id: 1, recipient_did_hash: 1 }, { name: 'ix_envelopes_version_recipient' }],
  ],
  asset_permissions: [
    // unique ACTIVE (asset_id, grantee_did_hash); revoke frees the slot instantly
    [{ asset_id: 1, grantee_did_hash: 1 }, { unique: true, name: 'uq_active_permission', partialFilterExpression: { active: true } }],
    [{ asset_id: 1, grantee_did_hash: 1, active: 1 }, { name: 'ix_permissions_asset_grantee_active' }],
    // partial index on expiry for scheduled expiry sweeps
    [{ expires_at: 1 }, { name: 'ix_permissions_expiry', partialFilterExpression: { active: true, expires_at: { $type: 'date' } } }],
  ],
  permission_history: [
    [{ event_key: 1 }, { unique: true, name: 'uq_event_key' }],
    [{ asset_id: 1, occurred_at: -1 }, { name: 'ix_perm_history_asset_time' }],
  ],
  merkle_root_versions: [
    [{ did_hash: 1, version: 1 }, { unique: true, name: 'uq_did_version' }],
    [{ did_hash: 1, version: -1 }, { name: 'ix_roots_did_version_desc' }],
  ],
  merkle_leaf_snapshots: [
    [{ did_hash: 1, root_version: 1, asset_id: 1 }, { unique: true, name: 'uq_did_version_asset' }],
    [{ did_hash: 1, root_version: 1, ordinal: 1 }, { unique: true, name: 'uq_did_version_ordinal' }],
  ],
  chain_blocks: [
    [{ block_hash: 1 }, { unique: true, name: 'uq_block_hash' }],
    [{ chain_id: 1, block_number: 1 }, { unique: true, name: 'uq_chain_block' }],
  ],
  chain_events: [
    [{ chain_id: 1, tx_hash: 1, log_index: 1 }, { unique: true, name: 'uq_tx_log' }],
    [{ finalized: 1, block_number: 1, log_index: 1 }, { name: 'ix_events_finalized_block_log' }],
    [{ dead_letter: 1 }, { name: 'ix_events_dead_letter', partialFilterExpression: { dead_letter: true } }],
  ],
  operations: [
    [{ caller_did_hash: 1, idempotency_key: 1 }, { unique: true, name: 'uq_idempotency' }],
    [{ caller_did_hash: 1, created_at: -1 }, { name: 'ix_operations_caller_time' }],
    [{ transaction_hash: 1 }, { name: 'ix_operations_tx', sparse: true }],
  ],
  audit_events: [
    [{ created_at: -1 }, { name: 'ix_audit_time' }],
    [{ correlation_id: 1 }, { name: 'ix_audit_correlation', sparse: true }],
  ],
  inheritance_rules: [
    [{ owner_did_hash: 1 }, { unique: true, name: 'uq_owner_rule' }],
  ],
  inheritance_asset_rules: [
    [{ owner_did_hash: 1, asset_id: 1 }, { unique: true, name: 'uq_owner_asset_rule' }],
  ],
  inheritance_cases: [
    [{ owner_did_hash: 1, status: 1 }, { name: 'ix_cases_owner_status' }],
  ],
};

/** Full collection list (22 collections, spec §4) with validator + index groups. */
export const COLLECTIONS = [
  'chain_blocks',
  'chain_events',
  'identities',
  'identity_keys',
  'webauthn_credentials',
  'sessions',
  'platform_roles',
  'assets',
  'asset_ownership_history',
  'asset_metadata',
  'document_versions',
  'storage_objects',
  'document_key_envelopes',
  'asset_permissions',
  'permission_history',
  'merkle_root_versions',
  'merkle_leaf_snapshots',
  'operations',
  'audit_events',
  'inheritance_rules',
  'inheritance_asset_rules',
  'inheritance_cases',
];
