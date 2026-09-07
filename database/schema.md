# Database Schema — Database & Merkle Team

Reference for the entire MongoDB Atlas database. 22 spec collections (§4) plus
indexer infrastructure collections (`indexer_state`, `indexer_alerts`,
`event_outbox`, `schema_migrations`).

## Conventions (documented choices)

| Convention | Choice |
|---|---|
| Application primary keys | **UUIDv7** strings, or the dummy-population `PREFIX0001` pattern (accepted by validators since migration 0009 — dev data only) |
| Token/asset IDs (`numeric(78,0)`) | **Decimal strings** (`^(0\|[1-9][0-9]{0,77})$`), bigint-backed in code — never loses precision for max uint256. Exact-match indexed; ordering done in code. |
| `bytes32` | **`0x`-prefixed 66-char lower-case hex strings** (validator-enforced). Binary extension type deliberately not adopted; documented per spec. |
| Wall-clock fields | **BSON `date`** — UTC instants, timezone-aware by definition (verified by test DB-SCHEMA-024). |
| Opaque blobs | `binData` for encrypted metadata / key envelopes / COSE keys — never usable key material. |
| Finality | Projection rows carry `finalized: bool`; ledger rows also carry `canonical` (+ `non_canonical_reason`) for reorg forensics. |
| Validation | Every collection has a strict `$jsonSchema` validator (`validationLevel: 'strict'`); partial unique indexes translate "unique while active" constraints. |

## Collections (spec §4)

### identities
| Field | Type | Constraints |
|---|---|---|
| id | string (uuidv7) | PK |
| did | string `^did:sih:[0-9a-f]{64}$` | **unique** |
| did_hash | bytes32 | **unique** |
| controller | string | **unique while status='active'** (partial unique index) |
| encryption_key_hash | bytes32 / null | |
| recovery_config_hash | bytes32 / null | |
| status | enum active/suspended/revoked | |
| event_key | string | chain event key (`chain:block:tx:log`) |

### identity_keys
id (uuidv7 PK), identity_id (uuidv7 FK→identities), key_type (enum
encryption/signing/recovery), public_key_hash (bytes32), active_from (date),
active_to (date/null).
**Exactly one active encryption key per identity** — partial unique index on
`identity_id` filtered `{key_type:'encryption', active_to:null}`.

### webauthn_credentials
id (PK), identity_id (FK), credential_id (string, **unique**), cose_public_key
(binData, opaque), sign_count (int/long), transports (array), last_used_at
(date/null).

### sessions
id (PK), identity_id (FK), refresh_hash (bytes32 **unique**), family_id
(uuidv7), expires_at (date), revoked_at (date/null), replaced_by (string/null).

### platform_roles
did_hash (bytes32), role (string), active (bool), event_key (string).
**Unique active role per DID/role** — partial unique index filtered
`{active:true}`. Revoke frees the slot immediately (tolerates revoke→re-grant).

### assets
asset_id (**unique**, decimal string = numeric(78,0)-equivalent), owner_did_hash
(bytes32, FK-projection), status (enum active/inactive/transferred),
document_hash / metadata_hash / storage_commitment (bytes32), current_version
(long), event_key (string), finalized (bool).
Indexes: `(owner_did_hash,status)`, `(status,current_version)`, unique `asset_id`.

### asset_ownership_history
id (PK), asset_id (FK), from_did_hash (bytes32/null), to_did_hash (bytes32),
cause (enum registered/transferred/inheritance), event_key (**unique**),
occurred_at (date), canonical (bool — never deleted on reorg, flagged).
Index `(asset_id, occurred_at desc)`.

### asset_metadata
id (PK), asset_id (FK), metadata_hash (bytes32), encrypted_metadata
(**binData — opaque, never plaintext**), visibility (enum private/shared/public),
created_at (date).

### document_versions
id (PK), asset_id (FK), version (long), document_hash / metadata_hash /
storage_commitment / ciphertext_hash (bytes32), byte_size (long), status (enum
staged/confirmed/orphaned/purged), finalized (bool), content_label (optional,
'unavailable' after purge).
**Unique (asset_id, version)**; index `(asset_id, version desc)`.

### storage_objects
id (PK), document_version_id (FK), provider (string), encrypted_object_ref
(string — **encrypted reference only, never a usable public URL**),
ciphertext_checksum (bytes32), state (enum
STAGED/CONFIRMED/ORPHANED/RETAINED/LEGAL_HOLD), retention_until (date/null),
confirmed_at (date/null), staged_at (date), orphaned_at (date, optional),
legal_hold (bool).
Indexes: `document_version_id`, `(state, staged_at)`.
Lifecycle: STAGED→GC only after 24h **and** reference recheck; CONFIRMED
requires a matching finalized document version; ORPHANED cleanup gated on the
audit retention window; RETAINED/LEGAL_HOLD never cleaned.

### document_key_envelopes
id (PK), document_version_id (FK), recipient_did_hash (bytes32),
encrypted_envelope (**binData opaque**), envelope_commitment (bytes32),
available_at (date), revoked_at (date/null).

### asset_permissions
asset_id (FK), grantee_did_hash (bytes32), permission_mask (long), expires_at
(date/null), active (bool), event_key (string).
**Unique active (asset_id, grantee_did_hash)** — partial unique index filtered
`{active:true}`; tolerates revoke→new-active with no false violation. Extra
indexes: `(asset_id, grantee_did_hash, active)`, partial expiry index
`{expires_at:1}` filtered `{active:true, expires_at:{$type:'date'}}`.

### permission_history
id (PK), asset_id (FK), grantee (bytes32), mask (long), action (enum
granted/revoked/cleared_on_transfer), event_key (**unique**), occurred_at
(date), canonical (bool). Index `(asset_id, occurred_at desc)`.

### merkle_root_versions
did_hash (bytes32), version (long), root (bytes32), operation_hash (bytes32),
block_number (long), tx_hash (bytes32), finalized (bool).
**Unique (did_hash, version)**; index `(did_hash, version desc)`.

### merkle_leaf_snapshots
did_hash (bytes32), root_version (long), asset_id (decimal string), leaf_hash
(bytes32), ordinal (int), root (bytes32), created_at (date).
**Immutable after write** (enforced at the write layer; no update path).
Unique (did_hash, root_version, asset_id) **and** unique (did_hash,
root_version, ordinal). Index `(did_hash, root_version, ordinal)`.

### chain_blocks
chain_id (num), block_number (long), block_hash (bytes32 **unique**),
parent_hash (bytes32), timestamp (date), finalized (bool), canonical (bool,
`false` retained for reorg forensics with non_canonical_reason).
Indexes: unique `(chain_id, block_number)`.

### chain_events
chain_id (num), tx_hash (bytes32), log_index (int), tx_index (int),
block_number (long), contract (string), abi_version (string), name (string),
payload (**object — the one flexible/opaque sub-document area**), finalized
(bool), canonical (bool + non_canonical_reason), dead_letter (bool +
dead_letter_reason).
**Unique (chain_id, tx_hash, log_index)** — duplicate ingestion is a no-op
upsert, not a failure. Index `(finalized, block_number, log_index)`,
dead-letter partial index.

### operations
id (uuidv7 PK), caller_did_hash (bytes32), idempotency_key (string,
**unique per caller**), request_hash (bytes32), type (string), status (enum
PENDING/SUBMITTED/CONFIRMED/FAILED/NEEDS_REFRESH/QUARANTINED),
transaction_hash (bytes32/null), expiry (date/null), created_at (date).
Indexes: `(caller_did_hash, created_at)`, `(transaction_hash)` sparse.
Optimistic status transitions (`expectedStatus` guard).

### audit_events
id (uuidv7 PK), actor_did_hash (bytes32/null), action (string), target_type
(string), target_id (string), correlation_id (string/null), immutable_payload
(**object, opaque**), source (enum **app/chain** — app entries can never
overwrite a chain fact), created_at (date). **Append-only** — no update/delete
path. Indexes: `created_at desc`, sparse `correlation_id`.

### inheritance_rules
owner_did_hash (bytes32 **unique**), default_nominee_did_hash (bytes32),
policy_hash (bytes32), status (enum active/inactive), event_key (string).

### inheritance_asset_rules
owner_did_hash (bytes32), asset_id (decimal string), beneficiary_did_hash
(bytes32), event_key (string). **Unique (owner_did_hash, asset_id)**.

### inheritance_cases
id (uuidv7 PK), owner_did_hash (bytes32), evidence_hash (bytes32),
authority_set_version (long), status (enum
PENDING/ACTIVATED/EXECUTED/CLOSED), activation_event_key (string/null).
Index `(owner_did_hash, status)`.

### Infrastructure (non-spec)
- `schema_migrations` — changelog (`_id` = migration id, description,
  indexImpact, hash, applied_at). Forward-only runner bookkeeping.
- `indexer_state` — ingestion/projection progress per chain/block.
- `indexer_alerts` — dead-letter, root_mismatch, P1, quarantine alerts.
- `event_outbox` — transactional outbox rows; published only after the
  projection transaction commits.

## Referential integrity & reorg safety
FKs are application-level checks. **References to provisional (non-final)
rows never block reorg rollback / delete-and-replay** (DB-SCHEMA-025);
finalized stale rows are flagged `canonical:false` and retained — history is
never overwritten in place or deleted.

## Migrations
Forward-only (`database/migrations/0001..0008`), one bounded concern each,
documented rollback-safe deployment procedure and index impact, tracked in
`schema_migrations`. Application code never changes schema at startup.
