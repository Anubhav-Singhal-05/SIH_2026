// Permission / Root / Operation / Audit repositories (§7).

import { normalizeHex32 } from '@sih/protocol';
import { uuidv7 } from '@sih/database/uuid7';
import { meta, getLastIndexedBlock, paginateCursor } from './base.js';

export class PermissionRepository {
  constructor(db) { this.db = db; }

  /** Active grant for (assetId, grantee); negative cases (expired/revoked) return null. */
  async getActive(assetId, didHash, { finalizedOnly = true } = {}) {
    const lastBlock = await getLastIndexedBlock(this.db);
    const now = new Date();
    const doc = await this.db.collection('asset_permissions').findOne({
      asset_id: String(assetId),
      grantee_did_hash: normalizeHex32(didHash),
      active: true,
      $or: [{ expires_at: null }, { expires_at: { $gt: now } }],
      ...(finalizedOnly ? { finalized: true } : {}),
    });
    return doc ? { ...doc, projection: meta(doc, lastBlock) } : null;
  }

  /** Expiry sweep: active grants past expiry (uses the expiry partial index). */
  async findExpired(now = new Date()) {
    return this.db.collection('asset_permissions')
      .find({ active: true, expires_at: { $lte: now, $ne: null } })
      .hint('ix_permissions_expiry')
      .toArray();
  }
}

export class RootRepository {
  constructor(db) { this.db = db; }

  async getCurrent(didHash) {
    const lastBlock = await getLastIndexedBlock(this.db);
    const doc = await this.db.collection('merkle_root_versions')
      .find({ did_hash: normalizeHex32(didHash), finalized: true })
      .sort({ version: -1 }).limit(1).next();
    return doc ? { ...doc, projection: meta(doc, lastBlock) } : null;
  }

  async getVersion(didHash, version) {
    const lastBlock = await getLastIndexedBlock(this.db);
    const doc = await this.db.collection('merkle_root_versions')
      .findOne({ did_hash: normalizeHex32(didHash), version: Number(version) });
    return doc ? { ...doc, projection: meta(doc, lastBlock) } : null;
  }
}

export class OperationRepository {
  constructor(db) { this.db = db; }

  async findByIdempotency(actorDidHash, idempotencyKey) {
    return this.db.collection('operations').findOne({
      caller_did_hash: normalizeHex32(actorDidHash), idempotency_key: idempotencyKey,
    });
  }

  /**
   * Optimistic status transition: succeeds only if the row is currently in
   * `expectedStatus`; returns null on mismatch (concurrency guard).
   */
  async transition(operationId, expectedStatus, nextStatus) {
    const res = await this.db.collection('operations').findOneAndUpdate(
      { id: operationId, status: expectedStatus },
      { $set: { status: nextStatus, updated_at: new Date() } },
      { returnDocument: 'after' },
    );
    return res ?? null;
  }

  async create({ callerDidHash, idempotencyKey, requestHash, type, expiry = null }) {
    const doc = {
      id: uuidv7(), caller_did_hash: normalizeHex32(callerDidHash), idempotency_key: idempotencyKey,
      request_hash: normalizeHex32(requestHash), type, status: 'PENDING',
      transaction_hash: null, expiry, created_at: new Date(),
    };
    await this.db.collection('operations').insertOne(doc);
    return doc;
  }
}

export class AuditRepository {
  constructor(db) { this.db = db; }

  /**
   * Append-only audit record. App entries supplement intent/security history
   * but can never overwrite a chain fact (chain entries carry source:'chain'
   * and are written only by the indexer).
   */
  async append({ actorDidHash = null, action, targetType, targetId, correlationId = null, payload = {} }) {
    const doc = {
      id: uuidv7(), actor_did_hash: actorDidHash ? normalizeHex32(actorDidHash) : null,
      action, target_type: targetType, target_id: String(targetId), correlation_id: correlationId,
      immutable_payload: payload, source: 'app', created_at: new Date(),
    };
    await this.db.collection('audit_events').insertOne(doc);
    return doc;
  }

  /** Chain-sourced audit entries (lifecycle facts). */
  async appendChain({ action, targetType, targetId, correlationId, payload }) {
    const doc = {
      id: uuidv7(), actor_did_hash: null, action, target_type: targetType,
      target_id: String(targetId), correlation_id: correlationId, immutable_payload: payload,
      source: 'chain', created_at: new Date(),
    };
    await this.db.collection('audit_events').insertOne(doc);
    return doc;
  }

  /** Read-back for the audit read model, newest first, cursor-paginated. */
  async list({ targetType, targetId, limit = 50, cursor } = {}) {
    const filter = {
      ...(targetType ? { target_type: targetType } : {}),
      ...(targetId ? { target_id: String(targetId) } : {}),
    };
    return paginateCursor(this.db.collection('audit_events'), filter, { cursor, limit, sortField: 'created_at' });
  }
}
