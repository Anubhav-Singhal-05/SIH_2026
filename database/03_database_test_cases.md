# Database & Merkle Team — Test Case Checklist

Scope: Mongo DB Atlas schema/migrations, reorg-aware event indexer, Merkle snapshot/proof service,
repositories, reconciliation, storage inventory/retention, backup/recovery. Derived from
`database_team_spec.md`.

---

## 1. Schema, migrations, and constraints

- [ ] DB-SCHEMA-001: All migrations apply cleanly to an empty database.
- [ ] DB-SCHEMA-002: All migrations apply cleanly on top of a prior-release production-like snapshot.
- [ ] DB-SCHEMA-003: Migrations are forward-only; each changes exactly one bounded concern.
- [ ] DB-SCHEMA-004: Each migration has a documented, tested rollback-safe deployment procedure.
- [ ] DB-SCHEMA-005: Application code never attempts schema changes at startup.
- [ ] DB-SCHEMA-006: `identities.did` and `identities.did_hash` are unique; duplicate insert fails.
- [ ] DB-SCHEMA-007: `identities.controller` is unique only while active — a rotated-out controller can be reused/is not blocked incorrectly.
- [ ] DB-SCHEMA-008: `identity_keys` enforces exactly one active encryption key per identity at a time.
- [ ] DB-SCHEMA-009: `webauthn_credentials.credential_id` is unique.
- [ ] DB-SCHEMA-010: `sessions.refresh_hash` is unique.
- [ ] DB-SCHEMA-011: `platform_roles` enforces a unique active role record per DID/role.
- [ ] DB-SCHEMA-012: `assets.asset_id` is unique and stored as numeric(78,0) without precision loss for max uint128 values.
- [ ] DB-SCHEMA-013: `asset_ownership_history` enforces unique event key (no duplicate ingestion row).
- [ ] DB-SCHEMA-014: `document_versions` enforces unique (asset_id, version).
- [ ] DB-SCHEMA-015: `asset_permissions` enforces unique active (asset_id, grantee_did_hash).
- [ ] DB-SCHEMA-016: Active-state partial unique constraint on `asset_permissions` tolerates an old grant becoming inactive on revoke/transfer, then a new active grant being created (no false unique violation).
- [ ] DB-SCHEMA-017: `merkle_root_versions` enforces unique (did_hash, version).
- [ ] DB-SCHEMA-018: `merkle_leaf_snapshots` enforces unique (did_hash, root_version, asset_id) AND unique (did_hash, root_version, ordinal).
- [ ] DB-SCHEMA-019: `chain_blocks.block_hash` is unique.
- [ ] DB-SCHEMA-020: `chain_events` enforces unique (chain_id, tx_hash, log_index) — duplicate log ingestion is a no-op, not an error that halts indexing.
- [ ] DB-SCHEMA-021: `inheritance_rules.owner_did_hash` is unique.
- [ ] DB-SCHEMA-022: `inheritance_asset_rules` enforces unique (owner_did_hash, asset_id).
- [ ] DB-SCHEMA-023: `bytes32` columns store consistent 0x-prefixed 66-char lower-case hex (case-normalization test).
- [ ] DB-SCHEMA-024: All wall-clock columns are `timestamptz`, not naive timestamps.
- [ ] DB-SCHEMA-025: Foreign keys on provisional (non-final) projections do not block reorg rollback/delete-and-replay.
- [ ] DB-SCHEMA-026: Required indexes exist and are used (EXPLAIN check) for: assets by owner+status, status+version, asset ID; ownership history by asset+time desc; document versions by asset+version desc; active permissions by asset+grantee with expiry partial index; root versions by DID+version desc; snapshots by DID+version+ordinal; chain events by finalized+block+log index; operations by caller+time and by tx hash.

## 2. Event indexing

- [ ] DB-INDEX-001: Indexer starts ingestion at the immutable contract deployment block from the manifest — not block 0, not "latest".
- [ ] DB-INDEX-002: Log fetching uses bounded range sizes with provider failover on error.
- [ ] DB-INDEX-003: Raw block and event records are stored idempotently (re-fetch of the same range does not duplicate rows).
- [ ] DB-INDEX-004: Only known ABI versions are decoded; an unknown/future event enters dead-letter state and raises an alert instead of crashing or silently dropping.
- [ ] DB-INDEX-005: Events are projected strictly in (block number, tx index, log index) order within a single DB transaction.
- [ ] DB-INDEX-006: `IdentityRegistered` creates an active identity projection with correct fields.
- [ ] DB-INDEX-007: `IdentityControllerRotated` updates controller/key fingerprint without touching unrelated fields.
- [ ] DB-INDEX-008: `IdentityStatusChanged` updates identity status projection.
- [ ] DB-INDEX-009: `AssetRegistered` creates asset + initial version + ownership history row and marks the matching staged document eligible for confirmation.
- [ ] DB-INDEX-010: `DocumentVersionUpdated` appends an immutable new version row and updates the asset's current hash/version pointer.
- [ ] DB-INDEX-011: `AssetTransferred` updates current owner, appends ownership history, and clears active permission rows for that asset.
- [ ] DB-INDEX-012: `AssetDeactivated` marks the asset projection inactive.
- [ ] DB-INDEX-013: `PlatformRoleGranted`/`PlatformRoleRevoked` update the role projection correctly (including reactivation edge case).
- [ ] DB-INDEX-014: `AccessGranted`/`AccessRevoked`/`AccessClearedOnTransfer` update permissions + permission history correctly.
- [ ] DB-INDEX-015: `MerkleRootUpdated` inserts a new root version row and activates the matching leaf snapshot.
- [ ] DB-INDEX-016: `InheritanceRuleSet` replaces the current rule/overrides in strict event order (later event always wins even if delivered same block).
- [ ] DB-INDEX-017: Inheritance activation/execution/close events (per full event catalog) update `inheritance_cases` status transitions correctly.
- [ ] DB-INDEX-018: Duplicate delivery of the same log (retry/replay from provider) does not double-apply any projection effect.
- [ ] DB-INDEX-019: Out-of-order provider pages are re-sorted before projection; projection order is never violated.
- [ ] DB-INDEX-020: Indexer resumes correctly from the last processed block after a restart/crash (no gap, no duplicate).
- [ ] DB-INDEX-021: Blocks/events are marked provisional until confirmation depth is reached, then final — never final before depth.
- [ ] DB-INDEX-022: A transactional outbox notification is emitted only after the projection DB transaction commits (never before, never on rollback).
- [ ] DB-INDEX-023: Reorg test — on parent-hash mismatch, the indexer locates the common ancestor.
- [ ] DB-INDEX-024: Reorg test — later (orphaned) blocks/events are marked non-final and affected projections are reversed/rebuilt.
- [ ] DB-INDEX-025: Reorg test — canonical logs are replayed and the projection reaches the correct final state.
- [ ] DB-INDEX-026: Reorg test — prior orphaned data is retained with a non-canonical flag for forensic audit, never silently deleted.
- [ ] DB-INDEX-027: Reorg reversal never overwrites history in place — history is append/flag based.

## 3. Merkle service

- [ ] DB-MERKLE-001: Leaf hash matches the exact formula `SHA256(0x00 || assetId[32] || ownerDidHash[32] || documentHash[32] || metadataHash[32] || documentVersion[8])` for known golden vectors.
- [ ] DB-MERKLE-002: Parent hash matches `SHA256(0x01 || left[32] || right[32])` for known vectors.
- [ ] DB-MERKLE-003: `EMPTY_ROOT` equals `SHA256(0x02)` exactly.
- [ ] DB-MERKLE-004: Leaves are strictly ordered ascending by unsigned 256-bit asset ID before tree construction; unsorted input is rejected or auto-sorted per design (assert the actual behavior).
- [ ] DB-MERKLE-005: Odd node at any tree level is duplicated correctly to compute the parent.
- [ ] DB-MERKLE-006: Single-leaf tree — root equals the leaf hash itself.
- [ ] DB-MERKLE-007: Zero-leaf (empty) state — root equals `EMPTY_ROOT`.
- [ ] DB-MERKLE-008: Even number of leaves computes correct root (golden vector).
- [ ] DB-MERKLE-009: Odd number of leaves computes correct root (golden vector, exercises duplication rule).
- [ ] DB-MERKLE-010: `prepareMint` returns correct before/after leaf snapshots, root values, versions, operation digest given a valid current state.
- [ ] DB-MERKLE-011: `prepareMint` rejects (blocks intent) when the projection's current root does not reproduce the expected old root read from chain.
- [ ] DB-MERKLE-012: `prepareDocumentUpdate` recomputes leaf correctly for changed document/metadata hash, same asset ID/ordinal.
- [ ] DB-MERKLE-013: `prepareTransfer` returns both a correct sender-removal transition and a correct recipient-addition transition.
- [ ] DB-MERKLE-014: `prepareDeactivation` returns a correct leaf-removal transition.
- [ ] DB-MERKLE-015: `generateProof` for zero leaves returns a well-formed empty/EMPTY_ROOT proof.
- [ ] DB-MERKLE-016: `generateProof` for exactly one leaf returns a trivially valid proof.
- [ ] DB-MERKLE-017: `generateProof` for an even leaf count produces a correct sibling path.
- [ ] DB-MERKLE-018: `generateProof` for an odd leaf count produces a correct sibling path (covers duplication).
- [ ] DB-MERKLE-019: `verifyProof` returns true for every valid proof generated above.
- [ ] DB-MERKLE-020: `verifyProof` returns false when a sibling in the proof is altered.
- [ ] DB-MERKLE-021: `verifyProof` returns false when the target leaf is altered.
- [ ] DB-MERKLE-022: `verifyProof` returns false when the wrong root version is targeted.
- [ ] DB-MERKLE-023: Proof response includes algorithm label, DID hash, root/version, asset ID, leaf, ordinal, ordered siblings, and a passing self-verification result.
- [ ] DB-MERKLE-024: A persisted leaf/root snapshot is never modified after being written (immutability enforced at write layer, e.g., no UPDATE path exists).
- [ ] DB-MERKLE-025: Snapshot is persisted only after the matching `MerkleRootUpdated` event finalizes — never before.
- [ ] DB-MERKLE-026: `reconcileRoot` detects drift between stored snapshot recomputation and the current on-chain root.
- [ ] DB-MERKLE-027: Golden vector test suite runs identically in the Node/service runtime and in a browser-compatible runtime (cross-runtime parity).
- [ ] DB-MERKLE-028 (failure policy): Old projection root differs from contract root at prepare-time → intent blocked, reconciliation alert raised.
- [ ] DB-MERKLE-029 (failure policy): Root goes stale between prepare and execution → operation status becomes `NEEDS_REFRESH`, recomputed from final state.
- [ ] DB-MERKLE-030 (failure policy): Asset event finalizes but the matching root event never arrives → P1 alert raised (atomicity-invariant violation or ABI/indexer fault).
- [ ] DB-MERKLE-031 (failure policy): A root event finalizes with no corresponding expected asset event for a known lifecycle operation → operation quarantined and chain state reconciled.

## 4. Repositories and query interfaces

- [ ] DB-REPO-001: No raw/inline SQL exists in feature modules outside the repository layer (static lint/grep check as part of CI).
- [ ] DB-REPO-002: `IdentityRepository.getFinalizedByDid` returns only finalized data, never provisional.
- [ ] DB-REPO-003: `AssetRepository.getAuthorizedList` respects query filters/pagination and returns only authorized/visible rows.
- [ ] DB-REPO-004: `AssetRepository.getFinalizedAsset` returns null/not-found for an asset with no finalized projection yet.
- [ ] DB-REPO-005: `AssetRepository.getOwnershipHistory` returns rows ordered by occurred_at descending, matching on-chain history.
- [ ] DB-REPO-006: `PermissionRepository.getActive` excludes expired/revoked grants.
- [ ] DB-REPO-007: `RootRepository.getCurrent`/`getVersion` return correct root/version, including historical lookups.
- [ ] DB-REPO-008: `OperationRepository.findByIdempotency` correctly matches on (actor, key).
- [ ] DB-REPO-009: `OperationRepository.transition` enforces optimistic concurrency — fails if `expectedStatus` doesn't match current row state (prevents lost-update races).
- [ ] DB-REPO-010: `AuditRepository.append` is append-only; no update/delete path exists for audit rows.
- [ ] DB-REPO-011: Application-sourced audit entries are clearly distinguishable from chain-sourced ones and can never overwrite/fabricate a chain lifecycle event.
- [ ] DB-REPO-012: Every asset list/detail response includes projection finalization metadata and last-indexed block number.
- [ ] DB-REPO-013: Cursor pagination is stable under concurrent inserts (no skipped/duplicated rows across pages).

## 5. Storage inventory, retention, and privacy

- [ ] DB-STORAGE-001: `storage_objects.encrypted_object_ref` is stored encrypted, never as a directly usable public URL.
- [ ] DB-STORAGE-002: No table/column stores plaintext document content, a raw data key, a verification salt in the clear, biometric material, or raw recovery material (schema audit test).
- [ ] DB-STORAGE-003: New upload starts as STAGED with no finalized asset reference.
- [ ] DB-STORAGE-004: STAGED object is garbage-collected only after the 24-hour minimum AND a reference recheck confirms it's still unreferenced.
- [ ] DB-STORAGE-005: STAGED object referenced by a since-confirmed asset is never garbage-collected even after 24 hours.
- [ ] DB-STORAGE-006: Object transitions to CONFIRMED only when a matching finalized asset document version exists.
- [ ] DB-STORAGE-007: ORPHANED objects (failed/expired chain operation) become eligible for cleanup only after the audit retention window elapses.
- [ ] DB-STORAGE-008: RETAINED/LEGAL_HOLD objects are never cleaned up regardless of age, until policy release.
- [ ] DB-STORAGE-009: Purge of an encrypted off-chain artifact is a policy-controlled action that produces an audit record.
- [ ] DB-STORAGE-010: After purge, on-chain hash/history is untouched; API-facing labeling communicates "content unavailable," never "deleted from blockchain."

## 6. Backup, recovery, and performance

- [ ] DB-BACKUP-001: Nightly encrypted backup completes successfully; point-in-time recovery window is available.
- [ ] DB-BACKUP-002: Monthly restore-test procedure succeeds against a real backup artifact.
- [ ] DB-BACKUP-003: Restore procedure: isolated restore → migrate → replay finalized chain logs → regenerate projections/snapshots → compare recomputed roots against chain → promote only after signed approval (each step independently testable/mockable).
- [ ] DB-BACKUP-004: A restored database is never promoted/trusted without a successful chain-state comparison step.
- [ ] DB-BACKUP-005: List/history endpoints use cursor pagination, selective column projection, and prepared statements (no N+1 / full scans under load test).
- [ ] DB-BACKUP-006: Query plans (EXPLAIN) confirm index usage for all primary query indexes listed in §1.
- [ ] DB-BACKUP-007: Monitoring emits: storage growth, event lag, query p95, deadlocks, failed migrations, root mismatch count, reorg rate, reconciliation duration, backup age.
- [ ] DB-BACKUP-008: Database disks and backups are encrypted at rest.
- [ ] DB-BACKUP-009: Service roles are least-privilege and isolated (a read-only role cannot write; an app role cannot alter chain-derived projection tables directly).
- [ ] DB-BACKUP-010: Credential rotation procedure works without downtime.
- [ ] DB-BACKUP-011: Migration access is audited; production console writes are denied except through a documented break-glass runbook (with its own audit trail).

## 7. Acceptance criteria (module-level)

- [ ] DB-ACCEPT-001: Full replay from the contract deployment block reproduces identical assets, ownership history, roles, permissions, roots, and inheritance state versus a reference/live chain.
- [ ] DB-ACCEPT-002: Every stored root snapshot independently recomputes (via the Merkle service) to the exact matching final `MerkleRootRegistry` root.
- [ ] DB-ACCEPT-003: No provisional (non-final-confirmation-depth) event is ever exposed to API consumers as confirmed.
- [ ] DB-ACCEPT-004: Reorg test reverses a stale projection completely and reaches the canonical final state with no leftover incorrect rows.
- [ ] DB-ACCEPT-005: An unauthorized database role cannot read encrypted sensitive fields or alter any chain-derived projection table.
- [ ] DB-ACCEPT-006: Constraint/index test suite, protocol golden-vector test, proof test suite, event-ingestion test suite, reconciliation-drift test, and backup/restore/replay test are all green in CI before milestone sign-off.
