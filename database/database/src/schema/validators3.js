import { BYTES32, DECIMAL_STRING, UUID } from './validators.js';

const str = (p) => ({ bsonType: 'string', ...(p ? { pattern: p } : {}) });
const ts = { bsonType: 'date' };
const NULLABLE_BYTES32 = { bsonType: ['null', 'string'], pattern: '^0x[0-9a-f]{64}$' };
const NULLABLE_STR = { bsonType: ['null', 'string'] };
const LONG = { bsonType: ['int', 'long', 'double'] };

export const VALIDATORS_3 = {
  merkle_root_versions: {
    bsonType: 'object',
    required: ['did_hash', 'version', 'root', 'operation_hash', 'block_number', 'tx_hash'],
    properties: {
      did_hash: BYTES32,
      version: LONG,
      root: BYTES32,
      operation_hash: BYTES32,
      block_number: LONG,
      tx_hash: BYTES32,
      finalized: { bsonType: 'bool' },
    },
  },
  merkle_leaf_snapshots: {
    bsonType: 'object',
    required: ['did_hash', 'root_version', 'asset_id', 'leaf_hash', 'ordinal'],
    properties: {
      did_hash: BYTES32,
      root_version: LONG,
      asset_id: DECIMAL_STRING,
      leaf_hash: BYTES32,
      ordinal: { bsonType: 'int' },
      root: BYTES32,
      created_at: ts,
    },
  },
  operations: {
    bsonType: 'object',
    required: ['id', 'caller_did_hash', 'idempotency_key', 'request_hash', 'type', 'status'],
    properties: {
      id: UUID,
      caller_did_hash: BYTES32,
      idempotency_key: str(),
      request_hash: BYTES32,
      type: str(),
      status: { enum: ['PENDING', 'SUBMITTED', 'CONFIRMED', 'FAILED', 'NEEDS_REFRESH', 'QUARANTINED'] },
      transaction_hash: NULLABLE_BYTES32,
      expiry: { bsonType: ['null', 'date'] },
      created_at: ts,
    },
  },
  audit_events: {
    bsonType: 'object',
    required: ['id', 'actor_did_hash', 'action', 'target_type', 'target_id', 'immutable_payload', 'created_at'],
    properties: {
      id: UUID,
      actor_did_hash: NULLABLE_BYTES32,
      action: str(),
      target_type: str(),
      target_id: str(),
      correlation_id: NULLABLE_STR,
      // Opaque audit payload; append-only (no update/delete path at write layer).
      immutable_payload: { bsonType: 'object' },
      source: { enum: ['app', 'chain'] },
      created_at: ts,
    },
  },
  inheritance_rules: {
    bsonType: 'object',
    required: ['owner_did_hash', 'default_nominee_did_hash', 'policy_hash', 'status', 'event_key'],
    properties: {
      owner_did_hash: BYTES32,
      default_nominee_did_hash: BYTES32,
      policy_hash: BYTES32,
      status: { enum: ['active', 'inactive'] },
      event_key: str(),
    },
  },
  inheritance_asset_rules: {
    bsonType: 'object',
    required: ['owner_did_hash', 'asset_id', 'beneficiary_did_hash', 'event_key'],
    properties: {
      owner_did_hash: BYTES32,
      asset_id: DECIMAL_STRING,
      beneficiary_did_hash: BYTES32,
      event_key: str(),
    },
  },
  inheritance_cases: {
    bsonType: 'object',
    required: ['id', 'owner_did_hash', 'evidence_hash', 'authority_set_version', 'status'],
    properties: {
      id: UUID,
      owner_did_hash: BYTES32,
      evidence_hash: BYTES32,
      authority_set_version: LONG,
      status: { enum: ['PENDING', 'ACTIVATED', 'EXECUTED', 'CLOSED'] },
      activation_event_key: NULLABLE_STR,
    },
  },
};
