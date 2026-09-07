// Merkle service — @sih/protocol is the SOLE legal algorithm source.
// Implements the §6 intent-calculation interface with drift rejection and the
// §6 root-update failure policy, plus immutable snapshot persistence.

import {
  merkleLeaf, computeRoot, emptyRoot, generateProof, verifyProof,
  normalizeHex32, encodeUint64, sha256, toHex32, parseHex32,
} from '@sih/protocol';

export const ALGORITHM_LABEL = 'sha256-leaf0x00-parent0x01-empty0x02-v1';
const OP_DIGEST_PREFIX = Buffer.from([0x04]);

export class RootDriftError extends Error {
  constructor(message, details) { super(message); this.name = 'RootDriftError'; this.details = details; }
}

/** Compute a leaf per the frozen formula. */
export function leafFor({ assetId, ownerDidHash, documentHash, metadataHash, documentVersion }) {
  return merkleLeaf({ assetId, ownerDidHash, documentHash, metadataHash, documentVersion });
}

/** operation digest = SHA256(0x04 || didHash || newRoot || version[8]) */
export function operationDigest(didHash, newRoot, version) {
  return toHex32(sha256(Buffer.concat([
    OP_DIGEST_PREFIX, parseHex32(didHash), parseHex32(newRoot), encodeUint64(version),
  ])));
}

/** Apply a state change to ordered leaf entries; output stays strictly ascending by asset id. */
export function applyChange(entries, change) {
  let next = entries.map((e) => ({ assetId: e.assetId, leafHash: e.leafHash }));
  switch (change.type) {
    case 'mint':
      next.push({ assetId: change.assetId, leafHash: change.leafHash });
      break;
    case 'update':
      next = next.map((e) => (e.assetId === String(change.assetId) ? { ...e, leafHash: change.leafHash } : e));
      break;
    case 'deactivate':
      next = next.filter((e) => e.assetId !== String(change.assetId));
      break;
    default:
      throw new Error(`unknown change type ${change.type}`);
  }
  next.sort((a, b) => (a.assetId < b.assetId ? -1 : a.assetId > b.assetId ? 1 : 0));
  return next;
}

/**
 * @typedef {Object} MerkleService
 * Uses merkle_leaf_snapshots as persisted leaf state per (did_hash,
 * root_version) and merkle_root_versions for finalized roots.
 */
export class MerkleService {
  /**
   * @param {import('mongodb').Db} db
   * @param {{ directRootRead?: (didHash: string, version: bigint) => Promise<string|null>,
   *           onAlert?: (alert: object) => Promise<void> }} opts
   * `directRootRead` is the direct-chain-read hook injected by the backend
   * (a direct chain read wins over the projection for prechecks).
   */
  constructor(db, { directRootRead, onAlert } = {}) {
    this.db = db;
    this.directRootRead = directRootRead ?? (async () => null);
    this.onAlert = onAlert ?? (async () => {});
  }

  /** Ordered leaf list for a DID/root version (ordinal order == ascending asset id). */
  async leaves(didHash, rootVersion) {
    const rows = await this.db.collection('merkle_leaf_snapshots')
      .find({ did_hash: normalizeHex32(didHash), root_version: Number(rootVersion) })
      .sort({ ordinal: 1 })
      .toArray();
    return rows.map((r) => ({ assetId: r.asset_id, leafHash: r.leaf_hash, ordinal: r.ordinal }));
  }

  /**
   * Build a RootTransition, REJECTING drift when the projection cannot
   * reproduce the expected old root (blocks the intent before any transaction
   * is offered, §6).
   */
  async transition(didHash, expectedVersion, expectedOldRoot, change) {
    didHash = normalizeHex32(didHash);
    const current = await this.leaves(didHash, Number(expectedVersion) - 1);
    const beforeRoot = current.length === 0 ? emptyRoot() : computeRoot(current);
    if (beforeRoot !== normalizeHex32(expectedOldRoot)) {
      const alert = {
        type: 'root_mismatch', did_hash: didHash, version: Number(expectedVersion) - 1,
        expected: normalizeHex32(expectedOldRoot), computed: beforeRoot, at: new Date(),
      };
      await this.alert(alert, 'drift');
      throw new RootDriftError(
        `projection cannot reproduce expected old root for ${didHash}@${Number(expectedVersion) - 1}`, alert,
      );
    }
    const afterEntries = applyChange(current, change);
    const afterRoot = afterEntries.length === 0 ? emptyRoot() : computeRoot(afterEntries);
    const leaves = afterEntries.map((e, i) => ({ assetId: e.assetId, leafHash: e.leafHash, ordinal: i }));
    return {
      algorithm: ALGORITHM_LABEL,
      didHash,
      before: { root: beforeRoot, version: Number(expectedVersion) - 1, leaves: current },
      after: { root: afterRoot, version: Number(expectedVersion), leaves },
      operationHash: operationDigest(didHash, afterRoot, expectedVersion),
      change,
    };
  }

  prepareMint(input) {
    const leafHash = leafFor(input);
    return this.transition(input.didHash, input.expectedVersion, input.expectedOldRoot, { type: 'mint', assetId: input.assetId, leafHash });
  }

  prepareDocumentUpdate(input) {
    const leafHash = leafFor(input);
    return this.transition(input.didHash, input.expectedVersion, input.expectedOldRoot, { type: 'update', assetId: input.assetId, leafHash });
  }

  prepareDeactivation({ didHash, assetId, expectedVersion, expectedOldRoot }) {
    return this.transition(didHash, expectedVersion, expectedOldRoot, { type: 'deactivate', assetId });
  }

  /** Transfer: FROM owner loses the leaf, TO owner gains it (two ordered transitions). */
  async prepareTransfer({ fromDidHash, toDidHash, assetId, fromLeaf, expectedFromVersion, expectedToVersion, expectedFromOldRoot, expectedToOldRoot }) {
    const from = await this.transition(fromDidHash, expectedFromVersion, expectedFromOldRoot, { type: 'deactivate', assetId });
    const to = await this.transition(toDidHash, expectedToVersion, expectedToOldRoot, { type: 'mint', assetId, leafHash: fromLeaf.leafHash });
    return { from, to };
  }

  /**
   * Persist an immutable leaf snapshot for (did, version) — only after a
   * matching FINAL MerkleRootUpdated event exists. Never modified after write.
   */
  async persistSnapshot(didHash, rootVersion, leaves) {
    didHash = normalizeHex32(didHash);
    const final = await this.db.collection('merkle_root_versions')
      .findOne({ did_hash: didHash, version: Number(rootVersion), finalized: true });
    if (!final) {
      throw new Error(`refusing to persist snapshot: no FINAL MerkleRootUpdated for ${didHash}@${rootVersion}`);
    }
    const existing = await this.db.collection('merkle_leaf_snapshots')
      .countDocuments({ did_hash: didHash, root_version: Number(rootVersion) });
    if (existing > 0) throw new Error('snapshot already persisted; snapshots are immutable'); // no update path
    const ops = leaves.map((leaf, i) => ({
      insertOne: {
        did_hash: didHash,
        root_version: Number(rootVersion),
        asset_id: String(leaf.assetId),
        leaf_hash: normalizeHex32(leaf.leafHash),
        ordinal: leaf.ordinal ?? i,
        root: final.root,
        created_at: new Date(),
      },
    }));
    if (ops.length) await this.db.collection('merkle_leaf_snapshots').bulkWrite(ops, { ordered: true });
    return ops.length;
  }

  /** Proof response: algorithm label, DID hash, root/version, asset ID, leaf, ordinal, siblings, self-verification. */
  async generateProof({ didHash, assetId, rootVersion }) {
    didHash = normalizeHex32(didHash);
    const entries = await this.leaves(didHash, Number(rootVersion));
    if (entries.length === 0) throw new Error(`no snapshot for ${didHash}@${rootVersion}`);
    const rootDoc = await this.db.collection('merkle_root_versions')
      .findOne({ did_hash: didHash, version: Number(rootVersion) });
    if (!rootDoc) throw new Error(`no root version ${didHash}@${rootVersion}`);
    const leaves = entries.map((e) => e.leafHash);
    const ordinal = entries.findIndex((e) => e.assetId === String(assetId));
    if (ordinal === -1) throw new Error(`asset ${assetId} not in snapshot ${didHash}@${rootVersion}`);
    const proof = generateProof(leaves, ordinal);
    const selfVerified = verifyProof({ ...proof, root: rootDoc.root });
    return {
      algorithm: ALGORITHM_LABEL, didHash, root: rootDoc.root, rootVersion: Number(rootVersion),
      assetId: String(assetId), leaf: proof.leaf, ordinal, siblings: proof.siblings, selfVerified,
    };
  }

  /** Verify an external proof against its stated root. */
  async verifyProof(proof) {
    return verifyProof({ leaf: proof.leaf, ordinal: proof.ordinal, siblings: proof.siblings, root: proof.root });
  }

  async alert(alert, level) {
    await this.db.collection('indexer_alerts').insertOne({ level, ...alert });
    await this.onAlert(alert);
  }

  /**
   * Reconcile a persisted root version against the chain root, implementing
   * the §6 root-update failure policy. Outcomes: OK / DRIFT / NEEDS_REFRESH /
   * P1 / QUARANTINE.
   */
  async reconcileRoot(didHash, rootVersion) {
    didHash = normalizeHex32(didHash);
    const version = Number(rootVersion);
    const rootDoc = await this.db.collection('merkle_root_versions').findOne({ did_hash: didHash, version });
    const snapshot = await this.leaves(didHash, version);
    const recomputed = snapshot.length === 0 ? emptyRoot() : computeRoot(snapshot);

    if (!rootDoc) {
      // root event never arrived — check whether a lifecycle asset event finalized
      const missing = await this.detectMissingRootEvent(didHash);
      if (missing) {
        const alert = { type: 'P1_atomicity', did_hash: didHash, version, detail: missing.detail, at: new Date() };
        await this.alert(alert, 'P1');
        return { status: 'P1', didHash, version, alert };
      }
      return { status: 'MISSING_ROOT', didHash, version, recomputed };
    }

    const chainRoot = await this.directRootRead(didHash, BigInt(version));
    if (chainRoot && chainRoot !== rootDoc.root) {
      const alert = {
        type: 'root_mismatch', did_hash: didHash, version,
        chain: chainRoot, stored: rootDoc.root, recomputed, at: new Date(),
      };
      await this.alert(alert, 'drift');
      return { status: 'DRIFT', didHash, version, recomputed, stored: rootDoc.root, chain: chainRoot, alert };
    }

    const latest = await this.db.collection('merkle_root_versions')
      .find({ did_hash: didHash }).sort({ version: -1 }).limit(1).next();
    if (latest && latest.version > version) {
      return { status: 'NEEDS_REFRESH', didHash, version, latestVersion: latest.version, recomputed };
    }

    const stray = await this.detectStrayRootEvent(didHash, snapshot);
    if (stray) {
      const alert = { type: 'quarantine', did_hash: didHash, version, detail: stray.detail, at: new Date() };
      await this.quarantineOperations(didHash);
      await this.alert(alert, 'quarantine');
      return { status: 'QUARANTINE', didHash, version, alert };
    }
    return { status: 'OK', didHash, version, recomputed, stored: rootDoc.root };
  }

  /** P1: a finalized asset lifecycle event for this DID but no final root event. */
  async detectMissingRootEvent(didHash) {
    const assets = await this.db.collection('assets')
      .countDocuments({ owner_did_hash: didHash, finalized: true });
    if (assets === 0) return null;
    const assetEv = await this.db.collection('chain_events').findOne({
      name: { $in: ['AssetRegistered', 'AssetTransferred', 'AssetDeactivated', 'DocumentVersionUpdated'] },
      finalized: true, canonical: true,
      $or: [{ 'payload.ownerDidHash': didHash }, { 'payload.toDidHash': didHash }],
    });
    return assetEv ? { detail: 'finalized asset event without matching final MerkleRootUpdated' } : null;
  }

  /** QUARANTINE: a root event exists but no finalized asset event backs a pending operation. */
  async detectStrayRootEvent(didHash, snapshot) {
    if (snapshot.length > 0) return null;
    const op = await this.db.collection('operations').findOne({
      caller_did_hash: didHash, status: { $in: ['PENDING', 'SUBMITTED'] },
    });
    return op ? { detail: 'root event finalized without expected asset event' } : null;
  }

  async quarantineOperations(didHash) {
    await this.db.collection('operations').updateMany(
      { caller_did_hash: didHash, status: { $in: ['PENDING', 'SUBMITTED'] } },
      { $set: { status: 'QUARANTINED', quarantined_at: new Date() } },
    );
  }
}
