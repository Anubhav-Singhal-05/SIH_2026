import { DomainError, ErrorCode } from './errors.js';
import { EMPTY_ROOT, leaf as computeLeaf } from './merkle.js';
import { normalizeHex32 } from './did.js';

export class IdentityProjectionRepository {
  constructor() {
    this.byDidHash = new Map();
  }

  upsert(identity) {
    this.byDidHash.set(identity.didHash.toLowerCase(), identity);
  }

  get(didHash) {
    return this.byDidHash.get(didHash.toLowerCase());
  }

  requireActive(didHash) {
    const id = this.get(didHash);
    if (!id || id.status === 'NONE') throw new DomainError(ErrorCode.DOCUMENT_NOT_READY, 'unknown identity');
    if (String(id.status).toUpperCase() !== 'ACTIVE') throw new DomainError(ErrorCode.FORBIDDEN, 'identity not active');
    return id;
  }
}

/** In-memory fixture for testing and offline execution. */
export class ProjectionRepository {
  constructor() {
    this.identitiesRepo = new IdentityProjectionRepository();
    this.assets = new Map();
    this.staged = new Map();
    this.operations = new Map();
    this.finalizedEvents = new Set();
    this.roots = new Map();
    this.permissions = new Map(); // `${assetId}:${granteeDidHash}` -> perm
    this.history = []; // ownership history rows
    this.versions = new Map(); // assetId -> Array<versionDoc>
  }

  upsertAsset(asset) {
    const id = asset.assetId.toString();
    this.assets.set(id, { ...asset, assetId: id });
    const vers = this.versions.get(id) ?? [];
    vers.push({
      assetId: id,
      version: Number(asset.documentVersion ?? 1),
      documentHash: asset.documentHash,
      metadataHash: asset.metadataHash,
      storageCommitment: asset.storageCommitment ?? '0x' + '00'.repeat(32),
      status: 'confirmed',
      createdAt: new Date(),
    });
    this.versions.set(id, vers);
  }

  getAsset(assetId) {
    return this.assets.get(assetId.toString());
  }

  async getAuthorizedList({ ownerDidHash, status, limit = 50 }) {
    const key = ownerDidHash.toLowerCase();
    const items = [...this.assets.values()]
      .filter((a) => a.ownerDidHash.toLowerCase() === key && (!status || a.status === status))
      .slice(0, limit);
    return { items, nextCursor: null, hasMore: false, lastIndexedBlock: 1 };
  }

  async getOwnershipHistory(assetId) {
    const items = this.history.filter((h) => h.assetId.toString() === assetId.toString());
    return { items, lastIndexedBlock: 1 };
  }

  async getVersions(assetId) {
    const items = this.versions.get(assetId.toString()) ?? [];
    return { items: [...items].reverse(), lastIndexedBlock: 1 };
  }

  async getActivePermission(assetId, granteeDidHash) {
    return this.permissions.get(`${assetId.toString()}:${granteeDidHash.toLowerCase()}`) ?? null;
  }

  setPermission(assetId, granteeDidHash, mask, expiresAt = null) {
    this.permissions.set(`${assetId.toString()}:${granteeDidHash.toLowerCase()}`, {
      assetId: assetId.toString(),
      granteeDidHash: granteeDidHash.toLowerCase(),
      mask: Number(mask),
      expiresAt,
      active: true,
    });
  }

  revokePermission(assetId, granteeDidHash) {
    this.permissions.delete(`${assetId.toString()}:${granteeDidHash.toLowerCase()}`);
  }

  activeLeaves(ownerDidHash) {
    const key = ownerDidHash.toLowerCase();
    const owned = [...this.assets.values()]
      .filter((a) => a.ownerDidHash.toLowerCase() === key && String(a.status).toUpperCase() === 'ACTIVE')
      .sort((a, b) => (BigInt(a.assetId) < BigInt(b.assetId) ? -1 : 1));
    const leaves = owned.map((a) => ({
      assetId: BigInt(a.assetId),
      leaf: computeLeaf(BigInt(a.assetId), a.ownerDidHash, a.documentHash, a.metadataHash, BigInt(a.documentVersion)),
    }));
    const saved = this.roots.get(key) ?? { oldRoot: EMPTY_ROOT, oldVersion: 0n };
    return { oldRoot: saved.oldRoot, oldVersion: saved.oldVersion, leaves };
  }

  setRoot(didHash, root, version) {
    this.roots.set(didHash.toLowerCase(), { oldRoot: root, oldVersion: BigInt(version) });
  }

  isFinalized(chainId, txHash, logIndex) {
    return this.finalizedEvents.has(`${chainId}|${txHash.toLowerCase()}|${logIndex}`);
  }

  markFinalized(chainId, txHash, logIndex) {
    this.finalizedEvents.add(`${chainId}|${txHash.toLowerCase()}|${logIndex}`);
  }

  saveStaged(obj) {
    this.staged.set(obj.stagedId, obj);
  }

  getStaged(stagedId) {
    return this.staged.get(stagedId);
  }

  saveOperation(op) {
    op.updatedAt = Date.now();
    this.operations.set(op.operationId, op);
  }

  getOperation(operationId) {
    return this.operations.get(operationId);
  }
}

/** MongoDB repository adapter that connects to Atlas collections. */
export class MongoRepository {
  constructor(db, externalRepos = {}) {
    this.db = db;
    this.identityRepo = externalRepos.identityRepo;
    this.assetRepo = externalRepos.assetRepo;
    this.permissionRepo = externalRepos.permissionRepo;
    this.rootRepo = externalRepos.rootRepo;
    this.opRepo = externalRepos.opRepo;
    this.auditRepo = externalRepos.auditRepo;
    this.merkleService = externalRepos.merkleService;

    // Delegate identity lookup
    this.identitiesRepo = {
      get: async (didHash) => {
        const hex = normalizeHex32(didHash);
        const doc = await this.db.collection('identities').findOne({ did_hash: hex });
        if (!doc) return null;
        return {
          did: doc.did,
          didHash: doc.did_hash,
          controller: doc.controller,
          encryptionKeyHash: doc.encryption_key_hash,
          status: String(doc.status).toUpperCase(),
        };
      },
      requireActive: async (didHash) => {
        const hex = normalizeHex32(didHash);
        const doc = await this.db.collection('identities').findOne({ did_hash: hex });
        if (!doc || doc.status === 'NONE') throw new DomainError(ErrorCode.DOCUMENT_NOT_READY, 'unknown identity');
        if (String(doc.status).toUpperCase() !== 'ACTIVE') throw new DomainError(ErrorCode.FORBIDDEN, 'identity not active');
        return {
          did: doc.did,
          didHash: doc.did_hash,
          controller: doc.controller,
          encryptionKeyHash: doc.encryption_key_hash,
          status: 'ACTIVE',
        };
      },
      upsert: async (identity) => {
        const hex = normalizeHex32(identity.didHash);
        await this.db.collection('identities').updateOne(
          { did_hash: hex },
          {
            $set: {
              did: identity.did,
              did_hash: hex,
              controller: identity.controller,
              encryption_key_hash: identity.encryptionKeyHash ?? null,
              status: String(identity.status ?? 'active').toLowerCase(),
              finalized: true,
              updated_at: new Date(),
            },
            $setOnInsert: { created_at: new Date() },
          },
          { upsert: true }
        );
      },
    };
  }

  async getAsset(assetId) {
    const id = String(assetId);
    const doc = await this.db.collection('assets').findOne({ asset_id: id });
    if (!doc) return null;
    return {
      assetId: doc.asset_id,
      ownerDidHash: doc.owner_did_hash,
      documentHash: doc.document_hash,
      metadataHash: doc.metadata_hash,
      storageCommitment: doc.storage_commitment,
      documentVersion: BigInt(doc.current_version ?? 1),
      status: String(doc.status).toUpperCase(),
      finalized: doc.finalized ?? true,
    };
  }

  async upsertAsset(asset) {
    const id = String(asset.assetId);
    await this.db.collection('assets').updateOne(
      { asset_id: id },
      {
        $set: {
          asset_id: id,
          owner_did_hash: normalizeHex32(asset.ownerDidHash),
          document_hash: normalizeHex32(asset.documentHash),
          metadata_hash: normalizeHex32(asset.metadataHash),
          storage_commitment: normalizeHex32(asset.storageCommitment ?? '0x' + '00'.repeat(32)),
          current_version: Number(asset.documentVersion ?? 1),
          status: String(asset.status ?? 'active').toLowerCase(),
          finalized: true,
          updated_at: new Date(),
        },
        $setOnInsert: { created_at: new Date() },
      },
      { upsert: true }
    );
  }

  async getAuthorizedList({ ownerDidHash, status, limit = 50, cursor }) {
    if (this.assetRepo) {
      return this.assetRepo.getAuthorizedList({ ownerDidHash, status, limit, cursor });
    }
    const filter = {
      owner_did_hash: normalizeHex32(ownerDidHash),
      ...(status ? { status: status.toLowerCase() } : {}),
    };
    const docs = await this.db.collection('assets').find(filter).limit(limit).toArray();
    const items = docs.map((d) => ({
      assetId: d.asset_id,
      ownerDidHash: d.owner_did_hash,
      documentHash: d.document_hash,
      metadataHash: d.metadata_hash,
      storageCommitment: d.storage_commitment,
      documentVersion: BigInt(d.current_version ?? 1),
      status: String(d.status).toUpperCase(),
    }));
    return { items, nextCursor: null, hasMore: false };
  }

  async getOwnershipHistory(assetId) {
    if (this.assetRepo) {
      return this.assetRepo.getOwnershipHistory(assetId);
    }
    const docs = await this.db.collection('asset_ownership_history')
      .find({ asset_id: String(assetId) })
      .sort({ occurred_at: -1 })
      .toArray();
    return { items: docs };
  }

  async getVersions(assetId) {
    if (this.assetRepo) {
      return this.assetRepo.getVersions(assetId);
    }
    const docs = await this.db.collection('document_versions')
      .find({ asset_id: String(assetId) })
      .sort({ version: -1 })
      .toArray();
    return { items: docs };
  }

  async getActivePermission(assetId, granteeDidHash) {
    if (this.permissionRepo) {
      return this.permissionRepo.getActive(assetId, granteeDidHash);
    }
    return this.db.collection('asset_permissions').findOne({
      asset_id: String(assetId),
      grantee_did_hash: normalizeHex32(granteeDidHash),
      active: true,
    });
  }

  async activeLeaves(ownerDidHash) {
    const hex = normalizeHex32(ownerDidHash);
    const owned = await this.db.collection('assets')
      .find({ owner_did_hash: hex, status: { $in: ['active', 'ACTIVE'] } })
      .toArray();

    owned.sort((a, b) => (BigInt(a.asset_id) < BigInt(b.asset_id) ? -1 : 1));
    const leaves = owned.map((a) => ({
      assetId: BigInt(a.asset_id),
      leaf: computeLeaf(BigInt(a.asset_id), a.owner_did_hash, a.document_hash, a.metadata_hash, BigInt(a.current_version ?? 1)),
    }));

    const rootDoc = await this.db.collection('merkle_root_versions')
      .find({ did_hash: hex })
      .sort({ version: -1 })
      .limit(1)
      .next();

    return {
      oldRoot: rootDoc?.root ?? EMPTY_ROOT,
      oldVersion: BigInt(rootDoc?.version ?? 0),
      leaves,
    };
  }

  async setRoot(didHash, root, version) {
    const hex = normalizeHex32(didHash);
    await this.db.collection('merkle_root_versions').updateOne(
      { did_hash: hex, version: Number(version) },
      {
        $set: {
          did_hash: hex,
          root: normalizeHex32(root),
          version: Number(version),
          updated_at: new Date(),
          finalized: true,
        },
      },
      { upsert: true }
    );
  }

  async saveStaged(obj) {
    await this.db.collection('storage_objects').updateOne(
      { id: obj.stagedId },
      {
        $set: {
          id: obj.stagedId,
          owner_did_hash: normalizeHex32(obj.ownerDidHash),
          objectKey: obj.objectKey,
          checksum_sha256: normalizeHex32('0x' + obj.checksumSha256).slice(2),
          byte_size: obj.byteSize,
          content_type: obj.contentType,
          state: obj.status ?? 'STAGED',
          updated_at: new Date(),
        },
        $setOnInsert: { staged_at: new Date() },
      },
      { upsert: true }
    );
  }

  async getStaged(stagedId) {
    const doc = await this.db.collection('storage_objects').findOne({ id: stagedId });
    if (!doc) return null;
    return {
      stagedId: doc.id,
      ownerDidHash: doc.owner_did_hash,
      objectKey: doc.objectKey,
      checksumSha256: doc.checksum_sha256,
      byteSize: doc.byte_size,
      status: doc.state,
    };
  }

  async saveOperation(op) {
    const id = op.operationId ?? op.id;
    await this.db.collection('operations').updateOne(
      { id },
      {
        $set: {
          id,
          caller_did_hash: op.callerDidHash ? normalizeHex32(op.callerDidHash) : null,
          status: op.status,
          permit_digest: op.permitDigest ?? null,
          permit_expires_at: op.permitExpiresAt ?? null,
          reserved_asset_id: op.reservedAssetId ? String(op.reservedAssetId) : null,
          transaction_hash: op.transactionHash ?? null,
          updated_at: new Date(),
        },
        $setOnInsert: { created_at: new Date() },
      },
      { upsert: true }
    );
  }

  async getOperation(operationId) {
    const doc = await this.db.collection('operations').findOne({ id: operationId });
    if (!doc) return null;
    return {
      operationId: doc.id,
      callerDidHash: doc.caller_did_hash,
      status: doc.status,
      permitDigest: doc.permit_digest,
      permitExpiresAt: doc.permit_expires_at,
      reservedAssetId: doc.reserved_asset_id,
      transactionHash: doc.transaction_hash,
    };
  }
}

