// Collection validators — MongoDB $jsonSchema translations of the spec's
// constraints. Documented type choices (see schema.md):
//   - bytes32  -> string, /^0x[0-9a-f]{64}$/ (0x-prefixed 66-char lower-case hex)
//   - uint256 asset ids -> decimal string (bigint-backed numeric(78,0) equivalent,
//     never loses precision at max uint256)
//   - wall-clock fields -> BSON date (UTC, timezone-aware)
//   - primary keys -> UUIDv7 strings

export const BYTES32 = { bsonType: 'string', pattern: '^0x[0-9a-f]{64}$' };
export const DECIMAL_STRING = { bsonType: 'string', pattern: '^(0|[1-9][0-9]{0,77})$' };
// Primary-key pattern: real UUIDv7, or the dummy-population `PREFIX0001`
// pattern produced by scripts/populate_dummy_data.py (documented in schema.md).
export const UUID = {
  bsonType: 'string',
  pattern: '^([0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[A-Z]{3}[0-9]{6})$',
};

const str = (p) => ({ bsonType: 'string', ...(p ? { pattern: p } : {}) });
const ts = { bsonType: 'date' };
const nullable = (v) => ({ bsonType: ['null', ...[Array.isArray(v) ? v[0] : v]], ...(v.pattern ? { pattern: v.pattern } : {}) });
const NULLABLE_BYTES32 = { bsonType: ['null', 'string'], pattern: '^0x[0-9a-f]{64}$' };
const NUM = { bsonType: ['int', 'long', 'double', 'decimal'] };

export const VALIDATORS = {
  chain_blocks: {
    bsonType: 'object',
    required: ['chain_id', 'block_number', 'block_hash', 'parent_hash', 'timestamp', 'finalized'],
    properties: {
      chain_id: NUM,
      block_number: { bsonType: ['int', 'long', 'double'] },
      block_hash: BYTES32,
      parent_hash: BYTES32,
      timestamp: ts,
      finalized: { bsonType: 'bool' },
      canonical: { bsonType: 'bool' },
    },
  },
  chain_events: {
    bsonType: 'object',
    required: ['chain_id', 'tx_hash', 'log_index', 'block_number', 'contract', 'abi_version', 'name', 'payload', 'finalized'],
    properties: {
      chain_id: NUM,
      tx_hash: BYTES32,
      log_index: { bsonType: 'int' },
      tx_index: { bsonType: 'int' },
      block_number: { bsonType: ['int', 'long', 'double'] },
      contract: str(),
      abi_version: str(),
      name: str(),
      // Opaque event payload is the one place flexible/opaque sub-documents are allowed.
      payload: { bsonType: 'object' },
      finalized: { bsonType: 'bool' },
      canonical: { bsonType: 'bool' },
      dead_letter: { bsonType: 'bool' },
      dead_letter_reason: { bsonType: ['null', 'string'] },
    },
  },
  identities: {
    bsonType: 'object',
    required: ['id', 'did', 'did_hash', 'controller', 'status', 'event_key'],
    properties: {
      id: UUID,
      did: str('^did:sih:[0-9a-f]{64}$'),
      did_hash: BYTES32,
      controller: str(),
      encryption_key_hash: NULLABLE_BYTES32,
      recovery_config_hash: NULLABLE_BYTES32,
      status: { enum: ['active', 'suspended', 'revoked'] },
      event_key: str(),
    },
  },
  identity_keys: {
    bsonType: 'object',
    required: ['id', 'identity_id', 'key_type', 'public_key_hash', 'active_from'],
    properties: {
      id: UUID,
      identity_id: UUID,
      key_type: { enum: ['encryption', 'signing', 'recovery'] },
      public_key_hash: BYTES32,
      active_from: ts,
      active_to: { bsonType: ['null', 'date'] },
    },
  },
  webauthn_credentials: {
    bsonType: 'object',
    required: ['id', 'identity_id', 'credential_id', 'cose_public_key', 'sign_count'],
    properties: {
      id: UUID,
      identity_id: UUID,
      credential_id: str(),
      // opaque binary blob — never a usable key material field
      cose_public_key: { bsonType: 'binData' },
      sign_count: { bsonType: ['int', 'long', 'double'] },
      transports: { bsonType: 'array' },
      last_used_at: { bsonType: ['null', 'date'] },
    },
  },
  sessions: {
    bsonType: 'object',
    required: ['id', 'identity_id', 'refresh_hash', 'family_id', 'expires_at'],
    properties: {
      id: UUID,
      identity_id: UUID,
      refresh_hash: BYTES32,
      family_id: UUID,
      expires_at: ts,
      revoked_at: { bsonType: ['null', 'date'] },
      replaced_by: { bsonType: ['null', 'string'] },
    },
  },
  platform_roles: {
    bsonType: 'object',
    required: ['did_hash', 'role', 'active', 'event_key'],
    properties: {
      did_hash: BYTES32,
      role: str(),
      active: { bsonType: 'bool' },
      event_key: str(),
    },
  },
};
