// Identity / Asset repositories (§7). No raw queries leak into feature
// modules — all access goes through typed repositories. Every list/detail
// response attaches projection finalization metadata and the last indexed
// block so the backend can decide whether a direct chain read is required.

import { normalizeHex32 } from '@sih/protocol';
import { meta, getLastIndexedBlock, paginateCursor } from './base.js';

export class IdentityRepository {
  constructor(db) { this.db = db; }

  /** Finalized identity projection by DID hash (provisional rows are never exposed). */
  async getFinalizedByDid(didHash) {
    const lastBlock = await getLastIndexedBlock(this.db);
    const doc = await this.db.collection('identities').findOne({
      did_hash: normalizeHex32(didHash), finalized: true, status: { $ne: 'revoked' },
    });
    return doc ? { ...doc, projection: meta(doc, lastBlock) } : null;
  }
}

export class AssetRepository {
  constructor(db) { this.db = db; }

  /**
   * Authorized asset list for an owner: finalized-only, cursor-paginated,
   * selective projection, finalization metadata attached.
   */
  async getAuthorizedList({ ownerDidHash, status, limit = 50, cursor, projection }) {
    const lastBlock = await getLastIndexedBlock(this.db);
    const filter = {
      owner_did_hash: normalizeHex32(ownerDidHash),
      finalized: true,
      ...(status ? { status } : {}),
    };
    const { items, nextCursor, hasMore } = await paginateCursor(
      this.db.collection('assets'), filter, { cursor, limit, sortField: 'asset_id', projection },
    );
    return { items: items.map((d) => ({ ...d, projection: meta(d, lastBlock) })), nextCursor, hasMore, lastIndexedBlock: lastBlock };
  }

  /** Finalized asset detail by numeric(78,0) asset id (string, precision-safe). */
  async getFinalizedAsset(assetId) {
    const lastBlock = await getLastIndexedBlock(this.db);
    const doc = await this.db.collection('assets').findOne({ asset_id: String(assetId), finalized: true });
    return doc ? { ...doc, projection: meta(doc, lastBlock) } : null;
  }

  /** Ownership history for an asset, newest first, finalized canonical rows. */
  async getOwnershipHistory(assetId, { limit = 50, cursor } = {}) {
    const lastBlock = await getLastIndexedBlock(this.db);
    const filter = { asset_id: String(assetId), canonical: { $ne: false }, finalized: true };
    const docs = await this.db.collection('asset_ownership_history')
      .find(filter).sort({ occurred_at: -1 }).limit(limit).toArray();
    return { items: docs, lastIndexedBlock: lastBlock, ...(cursor ? { cursor } : {}) };
  }

  /** Document versions, newest first. */
  async getVersions(assetId, { limit = 50 } = {}) {
    const lastBlock = await getLastIndexedBlock(this.db);
    const items = await this.db.collection('document_versions')
      .find({ asset_id: String(assetId), finalized: true, status: { $ne: 'purged' } })
      .sort({ version: -1 }).limit(limit).toArray();
    return { items, lastIndexedBlock: lastBlock };
  }
}
