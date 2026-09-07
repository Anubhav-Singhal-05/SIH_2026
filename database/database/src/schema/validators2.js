import { BYTES32, DECIMAL_STRING, UUID } from './validators.js';

const str = (p) => ({ bsonType: 'string', ...(p ? { pattern: p } : {}) });
const ts = { bsonType: 'date' };
const NULLABLE_BYTES32 = { bsonType: ['null', 'string'], pattern: '^0x[0-9a-f]{64}$' };
const NUM = { bsonType: ['int', 'long', 'double', 'decimal'] };
const LONG = { bsonType: ['int', 'long', 'double'] };

export const VALIDATORS_2 = {
  assets: {
    bsonType: 'object',
    required: ['asset_id', 'owner_did_hash', 'status', 'document_hash', 'metadata_hash', 'storage_commitment', 'current_version', 'event_key'],
    properties: {
      asset_id: DECIMAL_STRING, // numeric(78,0)-equivalent; unique
      owner_did_hash: BYTES32,
      status: { enum: ['active', 'inactive', 'transferred'] },
      document_hash: BYTES32,
      metadata_hash: BYTES32,
      storage_commitment: BYTES32,
      current_version: LONG,
      event_key: str(),
      finalized: { bsonType: 'bool' },
    },
  },
  asset_ownership_history: {
    bsonType: 'object',
    required: ['id', 'asset_id', 'to_did_hash', 'cause', 'event_key', 'occurred_at'],
    properties: {
      id: UUID,
      asset_id: DECIMAL_STRING,
      from_did_hash: NULLABLE_BYTES32,
      to_did_hash: BYTES32,
      cause: { enum: ['registered', 'transferred', 'inheritance'] },
      event_key: str(),
      occurred_at: ts,
      canonical: { bsonType: 'bool' },
    },
  },
  asset_metadata: {
    bsonType: 'object',
    required: ['id', 'asset_id', 'metadata_hash', 'encrypted_metadata', 'visibility', 'created_at'],
    properties: {
      id: UUID,
      asset_id: DECIMAL_STRING,
      metadata_hash: BYTES32,
      // Opaque encrypted blob (binData) — never plaintext metadata.
      encrypted_metadata: { bsonType: 'binData' },
      visibility: { enum: ['private', 'shared', 'public'] },
      created_at: ts,
    },
  },
  document_versions: {
    bsonType: 'object',
    required: ['id', 'asset_id', 'version', 'document_hash', 'metadata_hash', 'storage_commitment', 'ciphertext_hash', 'byte_size', 'status'],
    properties: {
      id: UUID,
      asset_id: DECIMAL_STRING,
      version: LONG,
      document_hash: BYTES32,
      metadata_hash: BYTES32,
      storage_commitment: BYTES32,
      ciphertext_hash: BYTES32,
      byte_size: LONG,
      status: { enum: ['staged', 'confirmed', 'orphaned', 'purged'] },
      finalized: { bsonType: 'bool' },
    },
  },
};
