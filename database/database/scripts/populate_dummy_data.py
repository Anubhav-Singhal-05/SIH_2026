#!/usr/bin/env python3
"""
populate_dummy_data.py — DUMMY/DEV DATA ONLY.

Populates a MongoDB Atlas database with schema-valid dummy/fixture data for
every collection defined in schema.md (22 spec collections + 4 infrastructure
collections). NO real user information, NO real chain data — every value is
synthetically generated. Never point this script at a production cluster.

Usage (from the repository root):

    python -m venv venv
    venv\\Scripts\\activate                 # Windows
    source venv/bin/activate               # macOS/Linux
    pip install -r requirements.txt

    # point atlas-credentials.env at YOUR Atlas cluster (see
    # atlas-credentials.env.example), then:

    python database/scripts/populate_dummy_data.py --identities 20 --assets 50 --seed 42 --reset

Flags:
    --identities N     number of identities to generate (default 20)
    --assets N         number of assets to generate (default 50)
    --seed N           seed the RNG for reproducible runs
    --reset            DROP all data collections first (schema_migrations is
                       preserved — migration history is not dummy data).
                       Without --reset, existing rows are left in place and
                       the script skips collections that already hold data
                       (safe by default, no duplicate-key crashes).

Credentials come from atlas-credentials.env at the repository root using the
standard variable names shared with the main project:
MONGODB_URI / MONGODB_DB_NAME (plus MONGODB_USERNAME / MONGODB_PASSWORD).
Nothing is hardcoded here. Process environment variables take precedence.
"""

from __future__ import annotations

import argparse
import base64
import os
import random
import secrets
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:
    from dotenv import dotenv_values
    from pymongo import MongoClient
    from pymongo.errors import PyMongoError
except ImportError:
    print("ERROR: missing dependencies. Create a venv and run: pip install -r requirements.txt", file=sys.stderr)
    sys.exit(2)

REPO_ROOT = Path(__file__).resolve().parents[2]

# ---------------------------------------------------------------------------
# Uniform ID pattern — one prefix + monotonic counter per entity type.
# (schema.md's real UUIDv7 convention is relaxed by migration 0009 to also
# accept this dummy `PREFIX0001` shape; never use these in production data.)
# ---------------------------------------------------------------------------
ID_PREFIXES = {
    "identities": "UID",
    "identity_keys": "IKY",
    "webauthn_credentials": "WCR",
    "sessions": "SES",
    "session_family": "FAM",
    "assets": "AST",            # document id for asset-adjacent records, NOT asset_id
    "asset_ownership_history": "AOH",
    "asset_metadata": "AMD",
    "document_versions": "DVR",
    "storage_objects": "STO",
    "document_key_envelopes": "DKE",
    "asset_permissions": "APM",
    "permission_history": "PMH",
    "operations": "OPR",
    "audit_events": "AUD",
    "inheritance_cases": "INC",
}
ID_WIDTH = 4  # UID0001

CHAINS = ["IdentityRegistry", "AssetRegistry", "AssetAccessRegistry", "MerkleRootRegistry", "InheritanceRegistry"]
EVENT_NAMES = [
    "IdentityRegistered", "IdentityControllerRotated", "IdentityStatusChanged",
    "AssetRegistered", "DocumentVersionUpdated", "AssetTransferred", "AssetDeactivated",
    "PlatformRoleGranted", "PlatformRoleRevoked",
    "AccessGranted", "AccessRevoked", "AccessClearedOnTransfer",
    "MerkleRootUpdated",
    "InheritanceRuleSet", "InheritanceActivated", "InheritanceBatchExecuted", "InheritanceClosed",
]
IDENTITY_STATUSES = ["active", "active", "active", "suspended", "revoked"]  # mostly active
ASSET_STATUSES = ["active", "active", "active", "inactive", "transferred"]
VERSION_STATUSES = ["confirmed", "confirmed", "staged", "orphaned", "purged"]
STORAGE_STATES = ["CONFIRMED", "CONFIRMED", "STAGED", "ORPHANED", "RETAINED", "LEGAL_HOLD"]
PERMISSION_ACTIONS = ["granted", "granted", "revoked", "cleared_on_transfer"]
OPERATION_STATUSES = ["PENDING", "SUBMITTED", "CONFIRMED", "CONFIRMED", "FAILED", "NEEDS_REFRESH", "QUARANTINED"]
INHERITANCE_CASE_STATUSES = ["PENDING", "ACTIVATED", "EXECUTED", "CLOSED"]
TRANSPORTS = ["usb", "nfc", "ble", "internal"]
ROLES = ["auditor", "operator", "admin", "recovery_agent"]


class Generator:
    """Dummy value generation (seeds Python's random; secrets for hash shapes)."""

    def __init__(self, rng: random.Random, chain_id: int = 31337, block: int = 1_000_000):
        self.rng = rng
        self.chain_id = chain_id
        self._block = block
        self._counters: dict[str, int] = {}
        self._used_asset_ids: set[str] = set()

    def next_id(self, entity: str) -> str:
        prefix = ID_PREFIXES[entity]
        self._counters[entity] = self._counters.get(entity, 0) + 1
        return f"{prefix}{self._counters[entity]:0{ID_WIDTH}d}"

    @staticmethod
    def bytes32() -> str:
        """0x-prefixed, 66-char, lower-case hex (schema bytes32 convention)."""
        return "0x" + secrets.token_hex(32)

    @staticmethod
    def b64_blob(n: int = 96) -> bytes:
        """Random opaque binary blob (binData fields) — never real key material."""
        return secrets.token_bytes(n)

    @staticmethod
    def opaque_ref() -> str:
        """Random opaque object reference — never a usable public URL."""
        return "vault://" + secrets.token_hex(8) + "/" + secrets.token_hex(16)

    @staticmethod
    def dummy_object(n: int = 4) -> dict:
        """Small opaque dummy JSON object (payload / immutable_payload)."""
        return {f"f{i}": base64.b64encode(secrets.token_bytes(9)).decode() for i in range(n)}

    def next_tx(self) -> str:
        return "0x" + secrets.token_hex(32)

    def event_key(self, block: int, tx: str, log_index: int) -> str:
        return f"{self.chain_id}:{block}:{tx}:{log_index}"

    def next_block(self) -> int:
        self._block += self.rng.randint(1, 5)
        return self._block

    def when(self, days: int, hours: int = 0) -> datetime:
        return datetime.now(timezone.utc) + timedelta(days=days, hours=hours)

    def unique_asset_id(self) -> str:
        """Large decimal string simulating a uint256 token id (not just small ints)."""
        while True:
            digits = self.rng.randint(60, 77)
            value = self.rng.randrange(10 ** (digits - 1), 10 ** digits)
            s = str(value)
            if s not in self._used_asset_ids:
                self._used_asset_ids.add(s)
                return s


class Populator:
    """Generates rows collection-by-collection in dependency order."""

    def __init__(self, db, g: Generator, n_identities: int, n_assets: int):
        self.db = db
        self.g = g
        self.n_identities = n_identities
        self.n_assets = n_assets
        self.summary: dict[str, int] = {}
        self.identities: list[dict] = []
        self.assets: list[dict] = []
        self.versions_by_asset: dict[str, list[dict]] = {}

    def insert(self, collection: str, rows: list[dict]) -> int:
        if not rows:
            self.summary[collection] = self.summary.get(collection, 0)
            return 0
        res = self.db[collection].insert_many(rows, ordered=False)
        self.summary[collection] = self.summary.get(collection, 0) + len(res.inserted_ids)
        return len(res.inserted_ids)

    def count(self, collection: str) -> int:
        return self.db[collection].count_documents({})

    # -- identity domain -----------------------------------------------------
    def gen_identities(self):
        rows = []
        for _ in range(self.n_identities):
            did_hash = self.g.bytes32()
            status = self.g.rng.choice(IDENTITY_STATUSES)
            rows.append({
                "id": self.g.next_id("identities"),
                "did": f"did:sih:{did_hash[2:]}",
                "did_hash": did_hash,
                "controller": "ctrl-" + did_hash[2:14],  # unique while active
                "encryption_key_hash": self.g.bytes32(),
                "recovery_config_hash": self.g.bytes32() if self.g.rng.random() < 0.4 else None,
                "status": status,
                "event_key": self.g.event_key(self.g.next_block(), self.g.next_tx(), 0),
            })
        self.identities = rows
        self.insert("identities", rows)

    def gen_identity_keys(self):
        rows = []
        for ident in self.identities:
            # exactly one ACTIVE encryption key per identity (active_to = null)
            rows.append({
                "id": self.g.next_id("identity_keys"),
                "identity_id": ident["id"],
                "key_type": "encryption",
                "public_key_hash": self.g.bytes32(),
                "active_from": self.g.when(-30),
                "active_to": None,
            })
            if self.g.rng.random() < 0.35:  # optional rotated-out key
                rows.append({
                    "id": self.g.next_id("identity_keys"),
                    "identity_id": ident["id"],
                    "key_type": self.g.rng.choice(["signing", "recovery"]),
                    "public_key_hash": self.g.bytes32(),
                    "active_from": self.g.when(-120),
                    "active_to": self.g.when(-31),
                })
        self.insert("identity_keys", rows)

    def gen_webauthn(self):
        rows = []
        for ident in self.identities[: max(1, self.n_identities // 2)]:
            rows.append({
                "id": self.g.next_id("webauthn_credentials"),
                "identity_id": ident["id"],
                "credential_id": "cred-" + secrets.token_hex(16),  # globally unique
                "cose_public_key": self.g.b64_blob(77),            # opaque blob
                "sign_count": self.g.rng.randint(0, 500),
                "transports": self.g.rng.sample(TRANSPORTS, k=self.g.rng.randint(1, 3)),
                "last_used_at": self.g.when(-self.g.rng.randint(0, 10)),
            })
        self.insert("webauthn_credentials", rows)

    def gen_sessions(self):
        rows = []
        for ident in self.identities[: max(1, self.n_identities * 3 // 4)]:
            family = self.g.next_id("session_family")
            for _ in range(self.g.rng.randint(1, 2)):
                rows.append({
                    "id": self.g.next_id("sessions"),
                    "identity_id": ident["id"],
                    "refresh_hash": self.g.bytes32(),
                    "family_id": family,
                    "expires_at": self.g.when(self.g.rng.randint(1, 14)),  # future
                    "revoked_at": self.g.when(-self.g.rng.randint(0, 5)) if self.g.rng.random() < 0.2 else None,
                    "replaced_by": None,
                })
        self.insert("sessions", rows)

    def gen_platform_roles(self):
        rows, seen = [], set()
        for ident in self.identities:
            if ident["status"] != "active" or self.g.rng.random() < 0.5:
                continue
            role = self.g.rng.choice(ROLES)
            if (ident["did_hash"], role) in seen:
                continue  # one active row per (did_hash, role)
            seen.add((ident["did_hash"], role))
            rows.append({
                "did_hash": ident["did_hash"], "role": role, "active": True,
                "event_key": self.g.event_key(self.g.next_block(), self.g.next_tx(), 1),
            })
        for ident in self.identities[-3:]:  # a few revoked historical rows
            rows.append({
                "did_hash": ident["did_hash"], "role": "auditor", "active": False,
                "event_key": self.g.event_key(self.g.next_block(), self.g.next_tx(), 2),
            })
        self.insert("platform_roles", rows)

    # -- asset domain --------------------------------------------------------
    def gen_assets(self):
        rows = []
        owners = [i for i in self.identities if i["status"] == "active"] or self.identities
        for _ in range(self.n_assets):
            owner = self.g.rng.choice(owners)
            n_versions = self.g.rng.randint(1, 4)
            rows.append({
                "asset_id": self.g.unique_asset_id(),  # large uint256-style decimal string
                "owner_did_hash": owner["did_hash"],
                "status": self.g.rng.choice(ASSET_STATUSES),
                "document_hash": self.g.bytes32(),
                "metadata_hash": self.g.bytes32(),
                "storage_commitment": self.g.bytes32(),
                "current_version": n_versions,  # matches # of document_versions rows
                "event_key": self.g.event_key(self.g.next_block(), self.g.next_tx(), 0),
                "finalized": True,
            })
        self.assets = rows
        self.insert("assets", rows)

    def gen_ownership_history(self):
        rows = []
        for asset in self.assets:
            rows.append({  # first row: registration, from_did_hash = null
                "id": self.g.next_id("asset_ownership_history"),
                "asset_id": asset["asset_id"],
                "from_did_hash": None,
                "to_did_hash": asset["owner_did_hash"],
                "cause": "registered",
                "event_key": self.g.event_key(self.g.next_block(), self.g.next_tx(), 0),
                "occurred_at": self.g.when(-self.g.rng.randint(30, 90)),
                "canonical": True,
            })
            if self.g.rng.random() < 0.4:  # later transfer row
                others = [i for i in self.identities if i["did_hash"] != asset["owner_did_hash"]]
                if others:
                    rows.append({
                        "id": self.g.next_id("asset_ownership_history"),
                        "asset_id": asset["asset_id"],
                        "from_did_hash": asset["owner_did_hash"],
                        "to_did_hash": self.g.rng.choice(others)["did_hash"],
                        "cause": "transferred",
                        "event_key": self.g.event_key(self.g.next_block(), self.g.next_tx(), 1),
                        "occurred_at": self.g.when(-self.g.rng.randint(1, 29)),
                        "canonical": True,
                    })
        self.insert("asset_ownership_history", rows)

    def gen_asset_metadata(self):
        rows = []
        for asset in self.assets:
            if self.g.rng.random() < 0.7:
                rows.append({
                    "id": self.g.next_id("asset_metadata"),
                    "asset_id": asset["asset_id"],
                    "metadata_hash": self.g.bytes32(),
                    "encrypted_metadata": self.g.b64_blob(128),  # opaque blob, never plaintext JSON
                    "visibility": self.g.rng.choice(["private", "private", "shared", "public"]),
                    "created_at": self.g.when(-self.g.rng.randint(1, 90)),
                })
        self.insert("asset_metadata", rows)

    def gen_document_versions(self):
        rows = []
        for asset in self.assets:
            for version in range(1, asset["current_version"] + 1):
                row = {
                    "id": self.g.next_id("document_versions"),
                    "asset_id": asset["asset_id"],
                    "version": version,  # unique (asset_id, version), starts at 1
                    "document_hash": self.g.bytes32(),
                    "metadata_hash": self.g.bytes32(),
                    "storage_commitment": self.g.bytes32(),
                    "ciphertext_hash": self.g.bytes32(),
                    "byte_size": self.g.rng.randint(1024, 5_000_000),
                    "status": self.g.rng.choice(VERSION_STATUSES),
                    "finalized": self.g.rng.random() < 0.85,
                }
                rows.append(row)
                self.versions_by_asset.setdefault(asset["asset_id"], []).append(row)
        self.insert("document_versions", rows)

    # -- storage / permissions ------------------------------------------------
    def gen_storage_objects(self):
        rows = []
        for versions in self.versions_by_asset.values():
            for dv in versions:
                if self.g.rng.random() < 0.8:
                    state = self.g.rng.choice(STORAGE_STATES)
                    rows.append({
                        "id": self.g.next_id("storage_objects"),
                        "document_version_id": dv["id"],
                        "provider": self.g.rng.choice(["ipfs-cluster", "s3-vault", "arweave-gw"]),
                        "encrypted_object_ref": self.g.opaque_ref(),  # never a usable public URL
                        "ciphertext_checksum": self.g.bytes32(),
                        "state": state,
                        "retention_until": self.g.when(self.g.rng.randint(90, 720)) if state in ("RETAINED", "LEGAL_HOLD") else None,
                        "confirmed_at": self.g.when(-self.g.rng.randint(1, 20)) if state == "CONFIRMED" else None,
                        "staged_at": self.g.when(-self.g.rng.randint(1, 30)),
                        "legal_hold": state == "LEGAL_HOLD",
                    })
        self.insert("storage_objects", rows)

    def gen_key_envelopes(self):
        rows = []
        active = [i for i in self.identities if i["status"] == "active"] or self.identities
        for versions in self.versions_by_asset.values():
            for dv in versions:
                for recipient in self.g.rng.sample(active, k=min(2, len(active))):
                    if self.g.rng.random() < 0.5:
                        rows.append({
                            "id": self.g.next_id("document_key_envelopes"),
                            "document_version_id": dv["id"],
                            "recipient_did_hash": recipient["did_hash"],
                            "encrypted_envelope": self.g.b64_blob(160),  # opaque blob
                            "envelope_commitment": self.g.bytes32(),
                            "available_at": self.g.when(-self.g.rng.randint(0, 10)),
                            "revoked_at": self.g.when(-1) if self.g.rng.random() < 0.15 else None,
                        })
        self.insert("document_key_envelopes", rows)

    def gen_permissions(self):
        rows, seen = [], set()
        grantees = [i for i in self.identities if i["status"] == "active"] or self.identities
        for asset in self.assets:
            for grantee in self.g.rng.sample(grantees, k=min(3, len(grantees))):
                if grantee["did_hash"] == asset["owner_did_hash"]:
                    continue
                if (asset["asset_id"], grantee["did_hash"]) in seen:
                    continue  # only one active row per (asset_id, grantee)
                seen.add((asset["asset_id"], grantee["did_hash"]))
                rows.append({
                    "asset_id": asset["asset_id"],
                    "grantee_did_hash": grantee["did_hash"],
                    "permission_mask": self.g.rng.randint(1, 7),
                    "expires_at": self.g.when(self.g.rng.randint(10, 365)) if self.g.rng.random() < 0.5 else None,
                    "active": True,
                    "event_key": self.g.event_key(self.g.next_block(), self.g.next_tx(), 3),
                })
        self.insert("asset_permissions", rows)

    def gen_permission_history(self):
        rows = []
        for asset in self.assets:
            for action in self.g.rng.sample(PERMISSION_ACTIONS, k=self.g.rng.randint(1, 3)):
                rows.append({
                    "id": self.g.next_id("permission_history"),
                    "asset_id": asset["asset_id"],
                    "grantee": self.g.rng.choice(self.identities)["did_hash"],
                    "mask": self.g.rng.randint(0, 7),
                    "action": action,
                    "event_key": self.g.event_key(self.g.next_block(), self.g.next_tx(), 4),
                    "occurred_at": self.g.when(-self.g.rng.randint(1, 60)),
                    "canonical": True,
                })
        self.insert("permission_history", rows)

    # -- merkle domain --------------------------------------------------------
    def gen_merkle(self):
        root_rows, leaf_rows = [], []
        active = [i for i in self.identities if i["status"] == "active"] or self.identities
        for owner in active[: max(1, len(active) // 2)]:
            n_versions = self.g.rng.randint(1, 2)  # per-DID versions 1..n, unique (did, version)
            for version in range(1, n_versions + 1):
                root = self.g.bytes32()
                root_rows.append({
                    "did_hash": owner["did_hash"], "version": version, "root": root,
                    "operation_hash": self.g.bytes32(),
                    "block_number": self.g.next_block(), "tx_hash": self.g.next_tx(),
                    "finalized": True,
                })
                if version == n_versions:
                    # snapshot leaves for the newest version; ordinal ascending by asset id
                    ids = sorted(self.g.rng.sample([a["asset_id"] for a in self.assets],
                                                   k=min(len(self.assets), self.g.rng.randint(2, 6))),
                                 key=int)
                    for ordinal, asset_id in enumerate(ids):
                        leaf_rows.append({
                            "did_hash": owner["did_hash"], "root_version": version,
                            "asset_id": asset_id, "leaf_hash": self.g.bytes32(),
                            "ordinal": ordinal, "root": root, "created_at": self.g.when(-1),
                        })
        self.insert("merkle_root_versions", root_rows)
        self.insert("merkle_leaf_snapshots", leaf_rows)

    # -- chain ledger ---------------------------------------------------------
    def gen_chain(self):
        n_blocks = max(10, self.n_assets)
        block_rows, event_rows = [], []
        parent = self.g.bytes32()
        for i in range(1, n_blocks + 1):
            block_hash = self.g.bytes32()
            block_rows.append({
                "chain_id": self.g.chain_id, "block_number": i, "block_hash": block_hash,
                "parent_hash": parent,  # each block's parent == previous block's hash
                "timestamp": self.g.when(i - n_blocks),
                "finalized": i <= n_blocks - 12,
                "canonical": True,
            })
            parent = block_hash
        for block in block_rows:
            for log_index in range(self.g.rng.randint(0, 3)):
                event_rows.append({
                    "chain_id": self.g.chain_id,
                    "tx_hash": self.g.next_tx(),
                    "log_index": log_index,  # unique (chain_id, tx_hash, log_index)
                    "tx_index": 0,
                    "block_number": block["block_number"],
                    "contract": self.g.rng.choice(CHAINS),
                    "abi_version": "1",
                    "name": self.g.rng.choice(EVENT_NAMES),
                    "payload": self.g.dummy_object(),  # small opaque dummy object
                    "finalized": block["finalized"],
                    "canonical": True,
                    "dead_letter": False,
                    "dead_letter_reason": None,
                })
        self.insert("chain_blocks", block_rows)
        self.insert("chain_events", event_rows)

    # -- operations / audit / inheritance --------------------------------------
    def gen_operations(self):
        rows = []
        for ident in self.identities:
            for _ in range(self.g.rng.randint(0, 3)):
                rows.append({
                    "id": self.g.next_id("operations"),
                    "caller_did_hash": ident["did_hash"],
                    "idempotency_key": "idem-" + secrets.token_hex(8),  # unique per caller
                    "request_hash": self.g.bytes32(),
                    "type": self.g.rng.choice(["mint", "document_update", "transfer", "deactivate"]),
                    "status": self.g.rng.choice(OPERATION_STATUSES),
                    "transaction_hash": self.g.bytes32() if self.g.rng.random() < 0.6 else None,
                    "expiry": self.g.when(self.g.rng.randint(1, 7)),
                    "created_at": self.g.when(-self.g.rng.randint(0, 5)),
                })
        self.insert("operations", rows)

    def gen_audit(self):
        rows = []
        for _ in range(self.n_assets):
            rows.append({
                "id": self.g.next_id("audit_events"),
                "actor_did_hash": self.g.rng.choice(self.identities)["did_hash"],
                "action": self.g.rng.choice([
                    "intent.prepare_mint", "intent.prepare_transfer", "session.login",
                    "storage.purged", "storage.gc.staged",
                ]),
                "target_type": self.g.rng.choice(["asset", "identity", "storage_object"]),
                "target_id": self.g.rng.choice(self.assets)["asset_id"],
                "correlation_id": self.g.next_id("operations") if self.g.rng.random() < 0.4 else None,
                "immutable_payload": self.g.dummy_object(),  # small opaque dummy object
                "source": "app" if self.g.rng.random() < 0.6 else "chain",  # split app/chain
                "created_at": self.g.when(-self.g.rng.randint(0, 30)),
            })
        self.insert("audit_events", rows)

    def gen_inheritance(self):
        rules, asset_rules, cases = [], [], []
        owners = [i for i in self.identities if i["status"] == "active"] or self.identities
        for owner in owners[: max(1, len(owners) // 2)]:  # unique owner_did_hash
            nominee = self.g.rng.choice([i for i in owners if i is not owner] or owners)
            rules.append({
                "owner_did_hash": owner["did_hash"],
                "default_nominee_did_hash": nominee["did_hash"],
                "policy_hash": self.g.bytes32(),
                "status": self.g.rng.choice(["active", "active", "inactive"]),
                "event_key": self.g.event_key(self.g.next_block(), self.g.next_tx(), 5),
            })
            for asset in self.g.rng.sample(self.assets, k=min(2, len(self.assets))):
                asset_rules.append({
                    "owner_did_hash": owner["did_hash"], "asset_id": asset["asset_id"],
                    "beneficiary_did_hash": nominee["did_hash"],
                    "event_key": self.g.event_key(self.g.next_block(), self.g.next_tx(), 6),
                })
            cases.append({
                "id": self.g.next_id("inheritance_cases"),
                "owner_did_hash": owner["did_hash"],
                "evidence_hash": self.g.bytes32(),
                "authority_set_version": self.g.rng.randint(1, 5),
                "status": self.g.rng.choice(INHERITANCE_CASE_STATUSES),
                "activation_event_key": self.g.event_key(self.g.next_block(), self.g.next_tx(), 7),
            })
        self.insert("inheritance_rules", rules)
        self.insert("inheritance_asset_rules", asset_rules)
        self.insert("inheritance_cases", cases)

    # -- infrastructure (light) -------------------------------------------------
    def gen_infrastructure(self):
        self.insert("indexer_state", [{
            "_id": f"progress:{self.g.chain_id}",
            "lastIngestedBlock": self.g._block,
            "lastProjectedBlock": self.g._block - 3,
            "at": self.g.when(0),
        }])
        self.insert("indexer_alerts", [{
            "level": self.g.rng.choice(["warn", "drift"]),
            "type": t,
            "event_key": self.g.event_key(self.g.next_block(), self.g.next_tx(), 8),
            "reason": "dummy alert row",
            "at": self.g.when(0),
        } for t in ("dead_letter", "root_mismatch")])
        self.insert("event_outbox", [{
            "event_key": self.g.event_key(self.g.next_block(), self.g.next_tx(), 9),
            "name": self.g.rng.choice(EVENT_NAMES),
            "block_number": self.g.next_block(),
            "payload": self.g.dummy_object(),
            "published": self.g.rng.random() < 0.5,
            "created_at": self.g.when(0),
        } for _ in range(3)])
        # schema_migrations holds REAL migration history, not dummy data — only
        # seed a representative row if the database was never migrated.
        if self.count("schema_migrations") == 0:
            self.insert("schema_migrations", [{
                "_id": "0001_chain_ledger",
                "description": "representative dummy row — run `npm run migrate` for real history",
                "indexImpact": "none", "hash": self.g.bytes32(), "applied_at": self.g.when(0),
            }])

    def run(self):
        print("Generating dependency-ordered dummy data...")
        self.gen_identities()
        self.gen_identity_keys()
        self.gen_webauthn()
        self.gen_sessions()
        self.gen_platform_roles()
        self.gen_assets()
        self.gen_ownership_history()
        self.gen_asset_metadata()
        self.gen_document_versions()
        self.gen_storage_objects()
        self.gen_key_envelopes()
        self.gen_permissions()
        self.gen_permission_history()
        self.gen_merkle()
        self.gen_chain()
        self.gen_operations()
        self.gen_audit()
        self.gen_inheritance()
        self.gen_infrastructure()


DATA_COLLECTIONS = [
    "identities", "identity_keys", "webauthn_credentials", "sessions", "platform_roles",
    "assets", "asset_ownership_history", "asset_metadata", "document_versions",
    "storage_objects", "document_key_envelopes", "asset_permissions", "permission_history",
    "merkle_root_versions", "merkle_leaf_snapshots", "chain_blocks", "chain_events",
    "operations", "audit_events", "inheritance_rules", "inheritance_asset_rules",
    "inheritance_cases", "indexer_state", "indexer_alerts", "event_outbox",
]


def load_credentials() -> tuple[str, str]:
    """Read Atlas credentials using the main project's standard variable names."""
    env_file = REPO_ROOT / "atlas-credentials.env"
    file_vals = dotenv_values(env_file) if env_file.exists() else {}
    uri = os.environ.get("MONGODB_URI") or file_vals.get("MONGODB_URI")
    db_name = os.environ.get("MONGODB_DB_NAME") or file_vals.get("MONGODB_DB_NAME") or "sih26_dev"
    if not uri:
        print(
            "ERROR: MONGODB_URI not found.\n"
            f"Create {env_file} (see atlas-credentials.env.example) with the standard\n"
            "Atlas variable names, or export MONGODB_URI in your shell.",
            file=sys.stderr,
        )
        sys.exit(2)
    return uri, db_name


def main() -> None:
    print("=" * 72)
    print("DUMMY/DEV DATA ONLY — synthetic values, no real users or chain data.")
    print("Never run this against a production cluster.")
    print("=" * 72)

    ap = argparse.ArgumentParser(description="Populate MongoDB Atlas with schema-valid dummy data (see header docstring).")
    ap.add_argument("--identities", type=int, default=20, help="number of identities (default 20)")
    ap.add_argument("--assets", type=int, default=50, help="number of assets (default 50)")
    ap.add_argument("--seed", type=int, default=None, help="RNG seed for reproducible enum/choice choices")
    ap.add_argument("--reset", action="store_true",
                    help="DROP all data collections first (schema_migrations is preserved)")
    args = ap.parse_args()

    uri, db_name = load_credentials()
    print(f"Connecting to Atlas (database: {db_name})...")
    try:
        client = MongoClient(uri, serverSelectionTimeoutMS=30_000)
        client.admin.command("ping")
    except PyMongoError as exc:
        print(f"ERROR: could not connect to Atlas: {exc}", file=sys.stderr)
        sys.exit(1)
    db = client[db_name]

    if args.reset:
        print(f"--reset given: dropping {len(DATA_COLLECTIONS)} data collections "
              "(schema_migrations preserved)...")
        for name in DATA_COLLECTIONS:
            db[name].drop()
    else:
        # safe default: refuse to double-populate a database that already has data
        existing = {name: db[name].count_documents({}) for name in DATA_COLLECTIONS}
        populated = {k: v for k, v in existing.items() if v > 0}
        if populated:
            print("Target database already contains data (no --reset given). Aborting.")
            for k, v in sorted(populated.items()):
                print(f"  {k}: {v} existing rows")
            print("Re-run with --reset to drop data collections and start fresh.")
            sys.exit(1)

    rng = random.Random(args.seed)
    pop = Populator(db, Generator(rng), args.identities, args.assets)
    try:
        pop.run()
    except PyMongoError as exc:
        print(f"ERROR: insert failed (validator or connection problem): {exc}", file=sys.stderr)
        client.close()
        sys.exit(1)

    print("\nInsert summary (collection -> rows inserted):")
    for name in sorted(pop.summary):
        print(f"  {name:28s} {pop.summary[name]:6d}")
    print(f"  {'TOTAL':28s} {sum(pop.summary.values()):6d}")
    print("\nDone. Dummy data is for development only.")
    client.close()


if __name__ == "__main__":
    main()
