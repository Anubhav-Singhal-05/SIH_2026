import { UUID } from './validators.js';

const str = (p) => ({ bsonType: 'string', ...(p ? { pattern: p } : {}) });
const ts = { bsonType: 'date' };
const BYTES32X = { bsonType: 'string', pattern: '^0x[0-9a-f]{64}$' };
const NULLABLE_BYTES32 = { bsonType: ['null', 'string'], pattern: '^0x[0-9a-f]{64}$' };
const DECIMAL_STRING = { bsonType: 'string', pattern: '^(0|[1-9][0-9]{0,77})$' };
const UUIDX = UUID;
const LONG = { bsonType: ['int', 'long', 'double'] };

export const VALIDATORS_2B = {
  storage_objects: {
    bsonType: 'object',
    required: ['id', 'document_version_id', 'provider', 'encrypted_object_ref', 'state'],
    properties: {
      id: UUIDX,
      document_version_id: UUIDX,
      provider: str(),
      // Encrypted object reference + checksum only — never a usable public URL.
      encrypted_object_ref: str('^[A-Za-z0-9_./:-]+$'),
      ciphertext_checksum: BYTES32X,
      state: { enum: ['STAGED', 'CONFIRMED', 'ORPHANED', 'RETAINED', 'LEGAL_HOLD'] },
      retention_until: { bsonType: ['null', 'date'] },
      confirmed_at: { bsonType: ['null', 'date'] },
      staged_at: ts,
      legal_hold: { bsonType: 'bool' },
    },
  },
  document_key_envelopes: {
    bsonType: 'object',
    required: ['id', 'document_version_id', 'recipient_did_hash', 'encrypted_envelope', 'envelope_commitment'],
    properties: {
      id: UUIDX,
      document_version_id: UUIDX,
      recipient_did_hash: BYTES32X,
      encrypted_envelope: { bsonType: 'binData' },
      envelope_commitment: BYTES32X,
      available_at: ts,
      revoked_at: { bsonType: ['null', 'date'] },
    },
  },
  asset_permissions: {
    bsonType: 'object',
    required: ['asset_id', 'grantee_did_hash', 'permission_mask', 'active', 'event_key'],
    properties: {
      asset_id: DECIMAL_STRING,
      grantee_did_hash: BYTES32X,
      permission_mask: LONG,
      expires_at: { bsonType: ['null', 'date'] },
      active: { bsonType: 'bool' },
      event_key: str(),
    },
  },
  permission_history: {
    bsonType: 'object',
    required: ['id', 'asset_id', 'grantee', 'mask', 'action', 'event_key', 'occurred_at'],
    properties: {
      id: UUIDX,
      asset_id: DECIMAL_STRING,
      grantee: BYTES32X,
      mask: LONG,
      action: { enum: ['granted', 'revoked', 'cleared_on_transfer'] },
      event_key: str(),
      occurred_at: ts,
      canonical: { bsonType: 'bool' },
    },
  },
};
