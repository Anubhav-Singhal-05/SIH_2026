// Storage inventory lifecycle (§8): STAGED/CONFIRMED/ORPHANED/RETAINED/
// LEGAL_HOLD bookkeeping and policy-controlled purge with audit records.
// The DB stores an encrypted object reference and ciphertext checksum —
// never a usable public URL, never key material.

import { normalizeHex32 } from '@sih/protocol';
import { uuidv7 } from '@sih/database/uuid7';
import { AuditRepository } from '../../infrastructure/repositories/ops.js';

export const DEFAULT_POLICY = {
  stagedGcHours: 24,           // STAGED GC only after 24h minimum...
  auditRetentionDays: 90,      // ...and (for ORPHANED) after the audit retention window
};

export class StorageLifecycleService {
  constructor(db, { policy = DEFAULT_POLICY, now = () => new Date() } = {}) {
    this.db = db;
    this.policy = { ...DEFAULT_POLICY, ...policy };
    this.now = now;
    this.audit = new AuditRepository(db);
  }

  /** STAGED: upload exists, no finalized asset reference yet. */
  async stage({ documentVersionId, provider, encryptedObjectRef, ciphertextChecksum, retentionUntil = null }) {
    const doc = {
      id: uuidv7(), document_version_id: documentVersionId, provider,
      encrypted_object_ref: encryptedObjectRef, // opaque encrypted ref, never a public URL
      ciphertext_checksum: ciphertextChecksum ? normalizeHex32(ciphertextChecksum) : null,
      state: 'STAGED', retention_until: retentionUntil, confirmed_at: null,
      staged_at: this.now(), legal_hold: false,
    };
    await this.db.collection('storage_objects').insertOne(doc);
    return doc;
  }

  /**
   * CONFIRMED transition requires a matching FINALIZED asset document version.
   * @returns the updated object, or null when no matching finalized version exists.
   */
  async confirm(documentVersionId) {
    const version = await this.db.collection('document_versions').findOne({
      _id: documentVersionId, finalized: true, status: 'confirmed',
    });
    if (!version) return null;
    const res = await this.db.collection('storage_objects').findOneAndUpdate(
      { document_version_id: documentVersionId, state: 'STAGED' },
      { $set: { state: 'CONFIRMED', confirmed_at: this.now() } },
      { returnDocument: 'after' },
    );
    return res ?? null;
  }

  /** Chain operation failed/expired: mark ORPHANED (audit-recorded). */
  async orphan(objectId, reason) {
    const res = await this.db.collection('storage_objects').findOneAndUpdate(
      { id: objectId, state: 'STAGED' },
      { $set: { state: 'ORPHANED', orphaned_at: this.now(), orphan_reason: reason } },
      { returnDocument: 'after' },
    );
    if (res) {
      await this.audit.append({
        action: 'storage.orphaned', targetType: 'storage_object', targetId: objectId, payload: { reason },
      });
    }
    return res ?? null;
  }

  /**
   * GC sweep. Returns { collected: [...] }.
   *  - STAGED: collect only after 24h AND a reference recheck that still finds
   *    no matching confirmed document version. A since-confirmed STAGED object
   *    is transitioned, never collected.
   *  - ORPHANED: eligible only after the audit retention window elapses.
   *  - RETAINED / LEGAL_HOLD: NEVER collected regardless of age.
   */
  async collectGarbage() {
    const now = this.now();
    const cutoff = new Date(now.getTime() - this.policy.stagedGcHours * 3600 * 1000);
    const collected = [];
    const staged = await this.db.collection('storage_objects')
      .find({ state: 'STAGED', staged_at: { $lte: cutoff } }).toArray();
    for (const obj of staged) {
      const version = await this.db.collection('document_versions').findOne({ _id: obj.document_version_id });
      const confirmedRef = version && version.finalized === true && version.status === 'confirmed';
      if (confirmedRef) {
        await this.confirm(obj.document_version_id); // since-confirmed: never GC'd
        continue;
      }
      await this.audit.append({
        action: 'storage.gc.staged', targetType: 'storage_object', targetId: obj.id,
        payload: { ref: obj.encrypted_object_ref },
      });
      await this.db.collection('storage_objects').deleteOne({ _id: obj._id });
      collected.push({ id: obj.id, state: 'STAGED' });
    }
    const orphanCutoff = new Date(now.getTime() - this.policy.auditRetentionDays * 24 * 3600 * 1000);
    const orphaned = await this.db.collection('storage_objects')
      .find({ state: 'ORPHANED', orphaned_at: { $lte: orphanCutoff } }).toArray();
    for (const obj of orphaned) {
      if (obj.legal_hold || obj.state === 'RETAINED' || obj.state === 'LEGAL_HOLD') continue; // never
      await this.audit.append({
        action: 'storage.gc.orphaned', targetType: 'storage_object', targetId: obj.id,
        payload: { ref: obj.encrypted_object_ref },
      });
      await this.db.collection('storage_objects').deleteOne({ _id: obj._id });
      collected.push({ id: obj.id, state: 'ORPHANED' });
    }
    return { collected };
  }

  /**
   * Policy-controlled purge of an encrypted off-chain artifact. Produces an
   * audit record, NEVER touches on-chain hash/history, and the API-facing
   * label is "content unavailable" (never "deleted from blockchain").
   */
  async purge(objectId, { policyDecision, approvedBy }) {
    if (!policyDecision) throw new Error('purge requires an explicit policy decision');
    const obj = await this.db.collection('storage_objects').findOne({ id: objectId });
    if (!obj) throw new Error(`storage object ${objectId} not found`);
    if (obj.legal_hold || obj.state === 'RETAINED' || obj.state === 'LEGAL_HOLD') {
      throw new Error('RETAINED/LEGAL_HOLD objects cannot be purged until policy release');
    }
    await this.audit.append({
      action: 'storage.purged', targetType: 'storage_object', targetId: objectId,
      payload: { ref: obj.encrypted_object_ref, approvedBy, policyDecision },
    });
    await this.db.collection('storage_objects').deleteOne({ _id: obj._id });
    // label the document version content unavailable; the chain fact remains
    await this.db.collection('document_versions').updateOne(
      { _id: obj.document_version_id },
      { $set: { content_available: false, content_label: 'unavailable' } },
    );
    return { purged: obj.id, contentLabel: 'unavailable' };
  }

  /** Apply / release a legal hold. */
  async setHold(objectId, hold) {
    await this.db.collection('storage_objects').updateOne(
      { id: objectId },
      { $set: { legal_hold: hold, state: hold ? 'LEGAL_HOLD' : 'CONFIRMED' } },
    );
  }
}
