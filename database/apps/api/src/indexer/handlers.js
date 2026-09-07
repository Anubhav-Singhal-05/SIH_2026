// Per-event projection handlers (§5 event catalog). Each write is idempotent
// per event key. `mark` carries the finalized flag of the source event.

import { normalizeHex32 } from '@sih/protocol';
import { uuidv7 } from '@sih/database/uuid7';

const dec = (p, f) => String(p[f]);
const at = (ev) => new Date(Number(ev.block_number) * 1000);

export async function applyIdentityAndAssetEvent(db, ev, session, mark) {
  const p = ev.payload ?? {};
  switch (ev.name) {
    case 'IdentityRegistered':
      await db.collection('identities').updateOne(
        { did_hash: p.didHash },
        {
          $setOnInsert: { id: uuidv7(), did: p.did, did_hash: p.didHash },
          $set: {
            controller: p.controller, encryption_key_hash: p.encryptionKeyHash ?? null,
            recovery_config_hash: null, status: 'active', event_key: evKeyOf(ev), ...mark,
          },
        },
        { upsert: true, session },
      );
      return;
    case 'IdentityControllerRotated':
      await db.collection('identities').updateOne(
        { did_hash: p.didHash },
        { $set: { controller: p.controller, encryption_key_hash: p.encryptionKeyHash ?? null, event_key: evKeyOf(ev), ...mark } },
        { session },
      );
      return;
    case 'IdentityStatusChanged':
      await db.collection('identities').updateOne(
        { did_hash: p.didHash },
        { $set: { status: p.status, event_key: evKeyOf(ev), ...mark } },
        { session },
      );
      return;
    case 'AssetRegistered': {
      const version = Number(p.version ?? 1);
      await db.collection('assets').updateOne(
        { asset_id: dec(p, 'assetId') },
        {
          $setOnInsert: { asset_id: dec(p, 'assetId') },
          $set: {
            owner_did_hash: p.ownerDidHash, status: 'active', document_hash: p.documentHash,
            metadata_hash: p.metadataHash, storage_commitment: p.storageCommitment,
            current_version: version, event_key: evKeyOf(ev), ...mark,
          },
        },
        { upsert: true, session },
      );
      await db.collection('asset_ownership_history').updateOne(
        { event_key: evKeyOf(ev) },
        {
          $setOnInsert: {
            id: uuidv7(), asset_id: dec(p, 'assetId'), from_did_hash: null, to_did_hash: p.ownerDidHash,
            cause: 'registered', occurred_at: at(ev), canonical: true,
          },
          $set: { finalized: ev.finalized === true },
        },
        { upsert: true, session },
      );
      await db.collection('document_versions').updateOne(
        { asset_id: dec(p, 'assetId'), version },
        {
          $setOnInsert: {
            id: uuidv7(), asset_id: dec(p, 'assetId'), version, document_hash: p.documentHash,
            metadata_hash: p.metadataHash, storage_commitment: p.storageCommitment,
            ciphertext_hash: p.ciphertextHash ?? p.documentHash, byte_size: Number(p.byteSize ?? 0), status: 'staged',
          },
          $set: { finalized: ev.finalized === true },
        },
        { upsert: true, session },
      );
      return;
    }
    case 'DocumentVersionUpdated': {
      const version = Number(p.version);
      await db.collection('document_versions').updateOne(
        { asset_id: dec(p, 'assetId'), version },
        {
          $setOnInsert: { id: uuidv7(), asset_id: dec(p, 'assetId'), version },
          $set: {
            document_hash: p.documentHash, metadata_hash: p.metadataHash,
            storage_commitment: p.storageCommitment, ciphertext_hash: p.ciphertextHash,
            byte_size: Number(p.byteSize ?? 0), status: 'confirmed', ...mark,
          },
        },
        { upsert: true, session },
      );
      await db.collection('assets').updateOne(
        { asset_id: dec(p, 'assetId') },
        { $set: { document_hash: p.documentHash, metadata_hash: p.metadataHash, storage_commitment: p.storageCommitment, current_version: version, event_key: evKeyOf(ev), ...mark } },
        { session },
      );
      return;
    }
    case 'AssetTransferred':
      await db.collection('assets').updateOne(
        { asset_id: dec(p, 'assetId') },
        { $set: { owner_did_hash: p.toDidHash, status: 'active', event_key: evKeyOf(ev), ...mark } },
        { session },
      );
      await db.collection('asset_ownership_history').updateOne(
        { event_key: evKeyOf(ev) },
        {
          $setOnInsert: {
            id: uuidv7(), asset_id: dec(p, 'assetId'), from_did_hash: p.fromDidHash, to_did_hash: p.toDidHash,
            cause: 'transferred', occurred_at: at(ev), canonical: true,
          },
          $set: { finalized: ev.finalized === true },
        },
        { upsert: true, session },
      );
      // clear active permissions on transfer
      await db.collection('asset_permissions').updateMany(
        { asset_id: dec(p, 'assetId'), active: true },
        { $set: { active: false, ...mark } },
        { session },
      );
      await db.collection('permission_history').updateOne(
        { event_key: evKeyOf(ev) },
        {
          $setOnInsert: {
            id: uuidv7(), asset_id: dec(p, 'assetId'), grantee: p.toDidHash, mask: 0,
            action: 'cleared_on_transfer', occurred_at: at(ev), canonical: true,
          },
          $set: { finalized: ev.finalized === true },
        },
        { upsert: true, session },
      );
      return;
    case 'AssetDeactivated':
      await db.collection('assets').updateOne(
        { asset_id: dec(p, 'assetId') },
        { $set: { status: 'inactive', event_key: evKeyOf(ev), ...mark } },
        { session },
      );
      return;
    default:
      throw new Error(`handler mismatch for ${ev.name}`);
  }
}

function evKeyOf(ev) {
  return `${ev.chain_id}:${ev.block_number}:${ev.tx_hash}:${ev.log_index}`;
}

export { normalizeHex32 };
