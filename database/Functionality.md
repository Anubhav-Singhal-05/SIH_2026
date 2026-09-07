# Functionality.md — role of every file in the project

Reference map of the repository. For the data model see `schema.md`; for
operating instructions see `README.md`.

## Repository root

| File | Role |
|---|---|
| `package.json` | npm workspace root. Defines the three workspaces (`packages/protocol`, `apps/api`, `database`) and the top-level scripts: `test`, `migrate`, `migrate:status`, `indexer`, `reconciler`, `lifecycle`, `backup:verify`. |
| `package-lock.json` | Lockfile pinning the exact dependency tree installed by `npm install`. |
| `requirements.txt` | Pinned Python dependencies (`pymongo`, `python-dotenv`) for the dummy-data population script; installed into `venv/`. |
| `schema.md` | Authoritative documentation of the entire MongoDB database: every collection's fields, types, uniqueness/index constraints, and type conventions. |
| `README.md` | How to install, run, operate, and test the project end-to-end. |
| `Functionality.md` | This file — the per-file map of the repository. |
| `.gitignore` | Excludes Atlas credentials, `node_modules/`, Python `venv/`/`__pycache__`, and log/output files from version control. |
| `atlas-credentials.env` | **Local, never committed** Atlas credentials using the standard variable names (`MONGODB_URI`, `MONGODB_DB_NAME`, `MONGODB_USERNAME`, `MONGODB_PASSWORD`). Read by both the Node (`database/src/env.js`) and Python (`database/scripts/populate_dummy_data.py`) layers. |
| `atlas-credentials.env.example` / `.env.example` | Committed templates documenting the expected credential variable names, with placeholder values. |
| `database_team_spec.md` | Original team specification this implementation follows (mission, schema, indexing, Merkle, retention, backup rules). |
| `03_database_test_cases.md` | The test-case checklist (`DB-SCHEMA-*`, `DB-INDEX-*`, `DB-MERKLE-*`, …); every automated test maps to one of these IDs. |

## `config/`

| File | Role |
|---|---|
| `deployment-manifest.json` | Immutable deployment record: `chainId`, `deploymentBlock` (the indexer's mandatory start point — never 0 or "latest"), `abiVersion`, the deployed contract list, and `confirmationDepth` for finalization. Loaded/validated by `apps/api/src/chain/manifest.js`. |

## `packages/protocol/` — the frozen algorithm source

| File | Role |
|---|---|
| `package.json` | Workspace manifest; exports the Merkle implementation and the frozen golden vectors (`./vectors`). |
| `src/index.js` | Public entry — re-exports `src/merkle/index.js`. |
| `src/merkle/index.js` | The **sole legal Merkle implementation**: `merkleLeaf` (`SHA256(0x00‖assetId‖ownerDidHash‖documentHash‖metadataHash‖version)`), `merkleParent` (`SHA256(0x01‖L‖R)`), `emptyRoot` (`SHA256(0x02)`), tree building with strict asset-id ordering and odd-node self-duplication, proof generation/verification, and uint256/uint64 big-endian encoders that never lose precision. |
| `test/merkle.test.js` | Golden-vector test suite: EMPTY_ROOT, leaf/parent formulas, ordering enforcement, odd duplication at every level, roots for 0/1/even/odd leaves, proofs for 1–7 leaves, negative proof cases, bytes32 normalization. |
| `test-vectors/merkle-vectors.json` | Frozen golden vectors (EMPTY_ROOT, three leaf vectors, three tree vectors). Any algorithm change must fail against this file. |
| `test-vectors/merkle-vectors.template.json` | Human-readable template showing how the frozen vector file is structured. |

## `database/` — schema, migrations, tooling

| File | Role |
|---|---|
| `package.json` | Workspace manifest; scripts: `migrate`, `migrate:status`, `test`, `verify`. Exports subpaths (`./db`, `./uuid7`, `./migrate`, `./schema`, `./test-util`, `./fixtures`) consumed by `apps/api`. |
| `src/index.js` | Public surface of the workspace (re-exports db, env, uuid7, migrate, schema). |
| `src/env.js` | Loads `atlas-credentials.env` from the repo root using the standard Atlas variable names; process env takes precedence. Never hardcodes credentials. |
| `src/db.js` | MongoDB Atlas connection singleton (`connect`/`getDb`/`disconnect`) with hardened driver settings. Connects only — application code never changes schema at startup (DB-SCHEMA-005). |
| `src/uuid7.js` | UUIDv7 generator (application primary-key convention) and validator. |
| `src/migrate.js` | **Forward-only migration runner**: applies `migrations/*.js` in lexical order, records each in `schema_migrations` (description, index impact, hash, timestamp); CLI modes `up` and `status`. `down()` is deliberately not supported. |
| `src/test-util.js` | **Test-scope only**: creates an ephemeral Atlas database (unique name), applies all migrations, and drops it on cleanup. |
| `src/schema/index.js` | Aggregates all validators + indexes, exports the 22-collection list and `ensureCollection()` (create/modify a collection with its validator and indexes) — called **only** by migrations. |
| `src/schema/validators.js` | `$jsonSchema` validators part 1: `chain_blocks`, `chain_events`, `identities`, `identity_keys`, `webauthn_credentials`, `sessions`, `platform_roles`; plus shared field-pattern constants (bytes32, decimal-string asset id, UUIDv7/dummy id). |
| `src/schema/validators2.js` | Validators part 2: `assets`, `asset_ownership_history`, `asset_metadata`, `document_versions`. |
| `src/schema/validators2b.js` | Validators part 2b: `storage_objects`, `document_key_envelopes`, `asset_permissions`, `permission_history`. |
| `src/schema/validators3.js` | Validators part 3: `merkle_root_versions`, `merkle_leaf_snapshots`, `operations`, `audit_events`, `inheritance_*`. |
| `src/schema/indexes.js` | Every index from spec §4, including partial unique indexes ("unique while active" constraints) and the EXPLAIN-verified primary query indexes. |
| `fixtures/fixtures.js` | **Test-scope only** fixture *builders* (schema-shaped rows for the JS test suites against ephemeral databases). |
| `migrations/0001_chain_ledger.js` | Raw chain ledger: `chain_blocks`, `chain_events`; also creates the indexer infrastructure collections (`indexer_state`, `indexer_alerts`, `event_outbox`). |
| `migrations/0002_identity_domain.js` | Identity domain: `identities`, `identity_keys`, `webauthn_credentials`, `sessions`, `platform_roles` (incl. partial-unique active controller / encryption key / role constraints). |
| `migrations/0003_asset_domain.js` | Asset domain: `assets`, `asset_ownership_history`, `asset_metadata`, `document_versions`. |
| `migrations/0004_storage_inventory.js` | Storage inventory: `storage_objects`, `document_key_envelopes`. |
| `migrations/0005_permissions_domain.js` | Permissions: `asset_permissions` (partial-unique active grant + expiry index), `permission_history`. |
| `migrations/0006_merkle_domain.js` | Merkle: `merkle_root_versions`, `merkle_leaf_snapshots` (both uniqueness rules). |
| `migrations/0007_operations_audit.js` | `operations` (unique idempotency per caller) and append-only `audit_events`. |
| `migrations/0008_inheritance_domain.js` | Inheritance: `inheritance_rules`, `inheritance_asset_rules`, `inheritance_cases`. |
| `migrations/0009_dummy_id_pattern.js` | Relaxes the `id` pattern to also accept the dummy-population `PREFIX0001` form (Python dev-data script only; real IDs remain UUIDv7). |
| `roles/roles.js` | Source of truth for the least-privilege Atlas roles (`sih26App`, `sih26ReadOnly`, `sih26Migrator`, `sih26BreakGlass`); prints `createRole`/`createUser` commands for the ops runbook. |
| `scripts/populate_dummy_data.py` | Python utility populating every collection (22 spec + 4 infrastructure) with schema-valid **dummy/dev data**: uniform `PREFIX0001` IDs, random shape-correct bytes32/opaque fields, dependency-ordered inserts, `--reset`/`--seed` flags, safe re-run behavior. |
| `scripts/verify_dummy_data.py` | Conformance auditor for the populated DB: bytes32 shapes, active-uniqueness rules, block parent-hash chain, snapshot ordinal ordering, version counting, prohibited-URL absence. |
| `test/schema-a.test.js` | DB-SCHEMA-001..011: migrations apply cleanly, forward-only with documented rollback procedures; "no schema changes at startup" static audit; identity-domain uniqueness. |
| `test/schema-b.test.js` | DB-SCHEMA-012..018: precision-safe asset ids, unique event keys, unique active grants, both leaf-snapshot uniqueness rules. |
| `test/schema-c.test.js` | DB-SCHEMA-019..026: ledger uniqueness + idempotent re-ingestion, bytes32 case normalization, UTC round-trip, provisional-FK reorg safety, EXPLAIN checks for every primary query index. |

## `apps/api/` — indexer, Merkle service, repositories, workers

| File | Role |
|---|---|
| `package.json` | Workspace manifest; depends on `@sih/protocol` and `@sih/database`; scripts `start` (worker dispatch: `indexer|reconciler|lifecycle`) and `test`. |
| `src/run.js` | Worker entry point — dispatches the CLI subcommand to the indexer pass, the reconciler (snapshot recompute + atomicity scan), or the storage-lifecycle GC sweep; closes the Atlas connection on exit. |
| `src/chain/manifest.js` | Loads and validates `config/deployment-manifest.json`; exposes `DEMO_MANIFEST`. Guarantees ingestion starts at the recorded deployment block (DB-INDEX-001). |
| `src/chain/provider.js` | Chain-provider abstraction: `FailoverProvider` (bounded range sizes, sticky failover across providers) and `InMemoryProvider` (deterministic fake chain for tests). |
| `src/indexer/index.js` | Indexer orchestrator (`runOnce`): ingest from last progress to head → reorg check → raw storage → dead-letter gate → strict-order projection → finalization → post-commit outbox publish. |
| `src/indexer/ingest.js` | Raw ledger ingestion: idempotent `$setOnInsert` upserts for blocks/events (re-fetch never duplicates or resets finality), `deadLetterUnknown()` for unknown ABI/event names, indexer progress state. |
| `src/indexer/project.js` | Projection engine: strict `(block, tx_index, log_index)` ordering, **one DB transaction per block**, idempotent event-key upserts, transactional outbox rows + post-commit `publishOutbox()`. |
| `src/indexer/handlers.js` | Per-event projection effects for identity + asset events (`IdentityRegistered/Rotated/StatusChanged`, `AssetRegistered`, `DocumentVersionUpdated`, `AssetTransferred` — incl. clearing active permissions, `AssetDeactivated`). |
| `src/indexer/handlers2.js` | Per-event projection effects for roles, permissions, merkle and inheritance events (`PlatformRoleGranted/Revoked`, `AccessGranted/Revoked/ClearedOnTransfer`, `MerkleRootUpdated`, `InheritanceRuleSet` with strict same-block ordering, `InheritanceActivated/BatchExecuted/Closed`). |
| `src/indexer/finalize.js` | Finalization: blocks/events become final only after `confirmationDepth`; finality cascades onto every projection derived from the finalized events (DB-ACCEPT-003). |
| `src/indexer/reorg.js` | Reorg handling: `detectReorg` walks parent hashes to the common ancestor; `handleReorg` flags orphaned blocks/events non-canonical (never deletes — forensic retention), deletes-and-replays provisional projections, flags finalized stale rows, then replays canonical replacement logs. |
| `src/infrastructure/repositories/base.js` | Repository plumbing: finalization metadata helper (`finalized` / `lastIndexedBlock` / `chainReadRecommended`), last-indexed-block lookup, stable cursor pagination. |
| `src/infrastructure/repositories/index.js` | `IdentityRepository` (`getFinalizedByDid`) and `AssetRepository` (`getAuthorizedList` finalized-only + cursor-paginated, `getFinalizedAsset`, `getOwnershipHistory`, `getVersions`). |
| `src/infrastructure/repositories/ops.js` | `PermissionRepository` (`getActive`, expiry sweep via partial index), `RootRepository` (`getCurrent`/`getVersion`), `OperationRepository` (idempotency lookup, optimistic `transition(expectedStatus)`), `AuditRepository` (append-only app/chain entries, list). |
| `src/modules/merkle/service.js` | `MerkleService`: ordered leaf state from snapshots, `prepareMint/prepareDocumentUpdate/prepareTransfer/prepareDeactivation` (drift rejection against the expected old root), `generateProof`/`verifyProof`, immutable `persistSnapshot` (only after a FINAL `MerkleRootUpdated`), `reconcileRoot` implementing the four failure-policy branches (DRIFT / NEEDS_REFRESH / P1 / QUARANTINE). |
| `src/workers/reconciler/index.js` | `verifyAllSnapshots` (every stored root recomputes to its finalized root — DB-ACCEPT-002), `scanAtomicityViolations` (finalized asset event without root event → P1), `quarantineOperation`. |
| `src/workers/lifecycle/index.js` | Storage inventory lifecycle (§8): STAGED→CONFIRMED (requires a matching finalized document version), orphaning, GC sweep (24h + reference recheck; retention window for ORPHANED; RETAINED/LEGAL_HOLD never cleaned), policy-controlled purge with audit record and "unavailable" labeling. |
| `src/workers/backup/replay.js` | Backup/restore pipeline (§9): isolated restore → migrate → replay finalized logs → regenerate snapshots → compare roots → promote **only** on a passing comparison + signed approval. Every step independently injectable/mockable. |

## `apps/api/test/` — indexer/Merkle/repository/storage/backup suites

| File | Role |
|---|---|
| `harness.js` | Shared test harness: ephemeral-Atlas-DB lifecycle (`withEphemeralDb`), deterministic in-memory chain builder (`makeProvider`), event/leaf fixtures, standard hashes. Test-scope only. |
| `indexing-a.test.js` | DB-INDEX-001..006: deployment-block start, bounded-range fetch + failover, idempotent raw storage, dead-letter + alert, strict (block, tx, log) ordering within one transaction. |
| `indexing-b.test.js` | DB-INDEX-008..011: every catalog event's documented projection effect (incl. same-block `InheritanceRuleSet` ordering), duplicate-log idempotency, out-of-order page re-sorting, clean restart/crash resume. |
| `indexing-c.test.js` | DB-INDEX-012..014 + DB-ACCEPT-003/004: provisional-until-confirmation-depth (repositories never expose provisional rows), outbox published only post-commit, full reorg test (ancestor location, non-canonical retention, projection rebuild). |
| `merkle-a.test.js` | Golden-vector parity in the service runtime, `prepareMint` (empty→root), update/transfer/deactivation transitions, drift rejection with alert. Exports `seedRoot`/leaf constants for the other suites. |
| `merkle-b.test.js` | Proof responses (algorithm label, DID, root/version, asset, leaf, ordinal, siblings, self-verification) with negative cases; snapshot final-only persistence + immutability at the write layer. |
| `merkle-c.test.js` | `reconcileRoot` DRIFT / NEEDS_REFRESH detection, P1 and QUARANTINE failure-policy branches, `verifyAllSnapshots` drift detection (DB-ACCEPT-002). |
| `repositories-a.test.js` | DB-REPO: finalized-only identity/asset reads with finalization metadata + last-indexed block, cursor pagination without overlap, permission negatives (expired/revoked), expiry sweep. |
| `repositories-b.test.js` | DB-REPO: root repository (provisional roots never exposed as current), optimistic `OperationRepository.transition`, append-only audit with app/chain source separation. |
| `storage.test.js` | DB-STORAGE-001..010: encrypted-ref-only fields, prohibited-column schema audit, 24h+recheck staged GC, since-confirmed never GC'd, confirmed-requires-finalized-version, orphan retention gating, legal holds, policy-controlled purge with audit + "unavailable" label. |
| `backup.test.js` | DB-BACKUP-003/004: each restore-pipeline step independently testable; promotion refused on failed root comparison or missing signed approval. |

## Python tooling (`database/scripts/`)

| File | Role |
|---|---|
| `populate_dummy_data.py` | Populate every collection with schema-valid **dummy/dev data** (see header docstring): one `PREFIX0001`-style ID counter per entity, random shape-correct bytes32/opaque fields, dependency-ordered inserts, `--identities/--assets/--seed/--reset` flags, refuses to double-populate without `--reset`. |
| `verify_dummy_data.py` | Post-population conformance audit: 15 schema-rule checks (bytes32 shapes, partial-unique actives, block parent chain, snapshot ordinals, version counting, no usable URLs, audit source split, untouched `schema_migrations`). |
