# Database and Merkle Team Specification

## 1. Mission and boundaries

Own Mongo DB Atlas schema migrations, database repositories, the blockchain event indexer, finalized query projections, Merkle snapshot/proof service, reconciliation, backup/recovery validation, and data-retention execution.

The database is a fast, rebuildable application read model. It cannot replace chain authority. AssetRegistry remains current ownership authority; AssetAccessRegistry remains permission authority; MerkleRootRegistry remains root authority. The database team must expose data that makes the application usable while preserving this hierarchy.

### In scope

- Mongo DB Atlas schema, migrations, seed fixtures, constraints, indexes, least-privilege roles, and repository interfaces.
- Reorg-aware ingestion of versioned contract events and finalized projections.
- Deterministic Merkle leaf/root/proof implementation using packages/protocol.
- Root/leaf snapshot persistence, proof API service contract, integrity reconciliation, data repair/replay procedures.
- Read models for dashboard, assets, versions, permissions, activity, audit, inheritance, operations, and verification.
- Backup/restore verification and lifecycle jobs for staged/retained data records.

### Out of scope

- Contract business rules, contract deployment, API/WebAuthn/session behavior, browser encryption, storage signed URL creation, or user wallet transaction submission.
- Inventing an alternate ownership or root calculation. The team must use the frozen protocol vectors.

## 2. Data authority and consistency rules

| Entity | Authority | Database role |
|---|---|---|
| Identity controller/status | IdentityRegistry | Finalized read projection |
| Asset current owner/status/version | AssetRegistry | Finalized read projection/history |
| Platform role/asset permission | AssetAccessRegistry | Finalized read projection/history |
| Current and historical root | MerkleRootRegistry | Snapshot/reference and validation |
| Inheritance rule/case | InheritanceRegistry | Finalized read projection |
| Ciphertext location/state | Storage provider plus confirmed asset version | Operational inventory |
| Operation intent | Backend service | Workflow record, never ownership fact |

Rules:

- Chain event projections are only marked final after environment confirmation depth.
- A direct chain read wins over a projection for high-risk backend action prechecks.
- Every projection must be reconstructable from deployment block logs, retained off-chain metadata, and configuration manifest.
- A chain reorg rolls back projections; it must never be hidden by overwriting history.
- Database-generated root values may prepare an intent but become authoritative only after matching MerkleRootRegistry event finalizes.

## 3. Technology and repository layout

Use Mongo DB Atlas current supported version, migration tool agreed in M0, prepared statements, transaction isolation appropriate to one block projection at a time, JSONB only for opaque event payload/audit data, and fixed normalized columns for query fields. Use Redis only as a cache/queue adjunct, never source of truth.

~~~text
database/
  migrations/
  seeds/
  fixtures/
  roles/
  scripts/
apps/api/src/
  infrastructure/repositories/
  workers/indexer/
  workers/reconciler/
  modules/merkle/
packages/protocol/
  src/did/
  src/merkle/
  test-vectors/
~~~

All migrations are forward-only. A migration changes one bounded concern, has rollback-safe deployment procedure, is tested against a production-like snapshot, and includes required index impact. Application code never changes schema at startup.

## 4. Schema and constraints

Use UUIDv7 primary keys for application rows, bigint/decimal-safe handling for token IDs, bytes32 as 0x-prefixed 66-character lower-case string where binary extension is not adopted, and timestamptz for all wall-clock data.

| Table | Required fields and constraints |
|---|---|
| identities | id, did unique, did_hash unique, controller unique while active, encryption_key_hash, recovery_config_hash, status, chain event key |
| identity_keys | id, identity_id FK, key_type, public_key_hash, active_from, active_to; one active encryption key per identity |
| webauthn_credentials | id, identity_id FK, credential_id unique, cose_public_key, sign_count, transports, last_used_at |
| sessions | id, identity_id FK, refresh_hash unique, family_id, expires_at, revoked_at, replaced_by |
| platform_roles | did_hash, role, active, event key; unique active role record |
| assets | asset_id numeric(78,0) unique, owner_did_hash FK projection, status, document_hash, metadata_hash, storage_commitment, current_version, finalized event key |
| asset_ownership_history | id, asset_id, from_did_hash nullable, to_did_hash, cause, event key unique, occurred_at |
| asset_metadata | id, asset_id FK, metadata_hash, encrypted_metadata, visibility, created_at |
| document_versions | id, asset_id FK, version, document_hash, metadata_hash, storage_commitment, ciphertext_hash, byte_size, status; unique asset/version |
| storage_objects | id, document_version_id FK, provider, encrypted_object_ref, state, retention_until, confirmed_at |
| document_key_envelopes | id, document_version_id FK, recipient_did_hash, encrypted_envelope, envelope_commitment, available_at, revoked_at |
| asset_permissions | asset_id, grantee_did_hash, permission_mask, expires_at, active, event key; unique active asset/grantee |
| permission_history | id, asset_id, grantee, mask, action, event key unique, occurred_at |
| merkle_root_versions | did_hash, version, root, operation_hash, block number, tx hash; unique DID/version |
| merkle_leaf_snapshots | did_hash, root_version, asset_id, leaf_hash, ordinal; unique DID/version/asset and DID/version/ordinal |
| chain_blocks | chain_id, block_number, block_hash unique, parent_hash, timestamp, finalized |
| chain_events | chain_id, tx_hash, log_index, block_number, contract, abi_version, name, payload, finalized; unique chain/tx/log |
| operations | id, caller_did_hash, idempotency_key, request_hash, type, status, transaction_hash, expiry |
| audit_events | id, actor_did_hash, action, target_type, target_id, correlation_id, immutable_payload, created_at |
| inheritance_rules | owner_did_hash unique, default_nominee_did_hash, policy_hash, status, event key |
| inheritance_asset_rules | owner_did_hash, asset_id, beneficiary_did_hash, event key; unique owner/asset |
| inheritance_cases | id, owner_did_hash, evidence_hash, authority_set_version, status, activated event key |

Primary query indexes:

- assets on owner DID + status, status + current version, and asset ID.
- ownership history on asset ID + occurred time descending.
- document versions on asset ID + version descending.
- active permissions on asset ID + grantee DID; expiry partial index.
- root versions on DID + version descending.
- snapshots on DID + root version + ordinal.
- chain events on finalized + block number + log index; blocks on chain + number.
- operations on caller DID + creation time and transaction hash.

Foreign keys protect application rows where possible. Do not foreign-key direct contract facts to provisional projections in a way that prevents reorg rollback. Active-state partial unique constraints must tolerate an old record becoming inactive on transfer/revoke.

## 5. Event indexing specification

### Event contract expected from blockchain team

| Event | Projection effect |
|---|---|
| IdentityRegistered | Create active identity projection |
| IdentityControllerRotated | Update controller/key fingerprint |
| IdentityStatusChanged | Update identity state |
| AssetRegistered | Create asset/version/history and mark staged document eligible for confirmation |
| DocumentVersionUpdated | Add immutable version and update asset current hashes/version |
| AssetTransferred | Update owner, append ownership history, clear active permissions |
| AssetDeactivated | Mark asset inactive |
| PlatformRoleGranted/Revoked | Update role projection |
| AccessGranted/Revoked/ClearedOnTransfer | Update permissions/history |
| MerkleRootUpdated | Insert root version; activate matching snapshot |
| InheritanceRuleSet | Replace current rule/overrides in event order |
| InheritanceActivated/BatchExecuted/Closed | Update inheritance case lifecycle/history |

### Indexing procedure

1. Start at immutable contract deployment block recorded in deployment manifest.
2. Fetch log ranges with provider failover and bounded range size.
3. Store raw block and event records idempotently.
4. Decode only known ABI version; unknown event enters dead-letter state and triggers alert.
5. Project events in block number, transaction index, log index order within one database transaction.
6. Mark blocks/events provisional until confirmation depth is reached, then final.
7. Emit transactional outbox notification only after projection commit.

On chain parent mismatch, locate the common ancestor, mark later blocks/events non-final, reverse/rebuild affected projections, and replay canonical logs. Keep raw prior data for forensic audit with canonical flag rather than silently deleting it.

## 6. Merkle service specification

Packages/protocol is the sole legal algorithm implementation. The service must use:

~~~text
leaf =
SHA256(0x00 || assetId[32] || ownerDidHash[32] || documentHash[32] ||
       metadataHash[32] || documentVersion[8])

parent = SHA256(0x01 || left[32] || right[32])
EMPTY_ROOT = SHA256(0x02)
~~~

Leaves are strictly ascending by unsigned 256-bit asset ID. The final odd node duplicates itself at each level. Single leaf is root. Empty asset state is EMPTY_ROOT.

### Intent calculation interface

~~~ts
interface MerkleService {
  prepareMint(input: MintState): Promise<RootTransition>;
  prepareDocumentUpdate(input: UpdateState): Promise<RootTransition>;
  prepareTransfer(input: TransferState): Promise<{ from: RootTransition; to: RootTransition }>;
  prepareDeactivation(input: DeactivationState): Promise<RootTransition>;
  generateProof(input: { didHash: Hex; assetId: bigint; rootVersion: bigint }): Promise<MerkleProof>;
  verifyProof(proof: MerkleProof): Promise<boolean>;
  reconcileRoot(didHash: Hex, rootVersion: bigint): Promise<ReconciliationResult>;
}
~~~

Each prepare method accepts expected root/version from direct contract read and returns ordered before/after leaf snapshots, root values, version values, operation digest, and proof-ready leaf data. It must reject a projection that does not reproduce the expected old root. This detects internal drift before a transaction is offered to user.

After a matching final MerkleRootUpdated event, persist immutable leaf snapshot for that DID/version. A root snapshot is never modified. Proof response includes algorithm label, DID hash, root/version, asset ID, leaf, leaf ordinal, ordered sibling list, and a self-verification result.

### Root update failure policy

- Old projection root differs from contract root: block intent and raise reconciliation alert.
- Root is stale at transaction execution: operation becomes NEEDS_REFRESH; recompute from final state.
- Asset event finalizes but matching root event absent: raise P1 because atomicity invariant was violated or ABI/indexer fault exists.
- Root event finalizes without expected asset event for a known lifecycle operation: quarantine operation and reconcile chain state.

## 7. Repository and query interface

Provide typed repositories with no raw SQL leaking into feature modules. Important read contracts:

~~~ts
IdentityRepository.getFinalizedByDid(didHash)
AssetRepository.getAuthorizedList(query)
AssetRepository.getFinalizedAsset(assetId)
AssetRepository.getOwnershipHistory(assetId)
PermissionRepository.getActive(assetId, didHash)
RootRepository.getCurrent(didHash)
RootRepository.getVersion(didHash, version)
OperationRepository.findByIdempotency(actor, key)
OperationRepository.transition(operationId, expectedStatus, nextStatus)
AuditRepository.append(event)
~~~

For every asset list/detail response, attach projection finalization metadata and last indexed block. Backend uses it to decide whether direct chain read is required.

The audit read model is append-only from application and chain sources. Application audit entries may supplement intent/security history but cannot fabricate chain lifecycle events.

## 8. Storage inventory, retention, and privacy

Database stores encrypted object reference and ciphertext checksum, not an accessible public URL. It stores encrypted metadata and encrypted key envelopes as opaque blobs. Data keys, verification salts, document plaintext, biometric material, and raw recovery material are prohibited columns.

Lifecycle:

- STAGED: upload exists but no finalized asset reference. Garbage collect only after 24 hours and reference recheck.
- CONFIRMED: matching finalized asset document version exists. Preserve per retention policy.
- ORPHANED: chain operation failed/expired; eligible for cleanup after audit retention window.
- RETAINED/LEGAL_HOLD: no cleanup until policy release.

Purging encrypted off-chain artifacts is a policy-controlled action with audit record. It does not remove on-chain hash/history; API must label historical document content unavailable rather than implying deletion of blockchain fact.

## 9. Backup, recovery, and performance

- Nightly encrypted Mongo DB Atlas backups with point-in-time recovery; test restoration monthly.
- Retain chain event/archive access from deployment blocks and deployment manifests/ABI versions.
- Restore procedure: isolated restore, migrate, replay finalized chain logs, regenerate projections/leaf snapshots, compare roots, then promote after signed approval.
- Monitor storage growth, event lag, query p95, deadlocks, failed migrations, root mismatch count, reorg rate, reconciliation duration, and backup age.
- Use cursor pagination, selective columns, prepared queries, and EXPLAIN-reviewed indexes for list/history endpoints.
- Encrypt database disks/backups, isolate service roles, rotate credentials, audit migration access, and deny production console writes except break-glass runbook.

## 10. Tests, acceptance, and milestones

### Required tests

- Migration test from empty database and prior release snapshot.
- Constraint/index tests for active uniqueness, event idempotency, root snapshot immutability, and reorg-safe state.
- Protocol golden vector test in service and browser-compatible runtime.
- Proof test for empty, one, even, odd leaves, altered sibling, wrong version, transfer, update, and deactivation.
- Event ingestion test for every blockchain event, duplicate logs, out-of-order provider pages, restart, reorg, ABI mismatch, and dead-letter.
- Reconciliation test that introduces drift and verifies alert/block action.
- Backup restore plus complete replay test.

### Acceptance criteria

- Starting from contract deployment block, replay reproduces assets, ownership history, roles, permissions, roots, and inheritance state.
- Stored root snapshot always independently recomputes to matching final MerkleRootRegistry root.
- No provisional event is exposed as confirmed to API consumers.
- Reorg test reverses stale projection and reaches canonical final state.
- Unauthorized database role cannot read encrypted sensitive fields or alter chain-derived projection tables.

| Milestone | Deliverable | Dependency |
|---|---|---|
| D0 | ERD, migration convention, repository contracts, seed fixtures | Protocol identifiers/events |
| D1 | Core schema, event raw ledger, initial asset/identity projections | Contract ABI/events |
| D2 | Root snapshots, intent calculation, proofs, vector validation | Frozen Merkle vectors |
| D3 | Reorg/finalization, dashboards/history queries, storage lifecycle | Backend operation contract |
| D4 | Reconciliation, backup/replay, performance/security review | Integrated staging |

Changes to event payload, root bytes, asset ID type, permission policy, or finalization semantics require review by all teams before migration or deployment.
