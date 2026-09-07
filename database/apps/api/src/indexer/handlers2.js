// Handlers for roles, permissions, merkle roots and inheritance events.
// Same-block InheritanceRuleSet events are applied in (tx_index, log_index)
// order by the projection engine, so overrides land in strict event order.

import { normalizeHex32 } from '@sih/protocol';
import { uuidv7 } from '@sih/database/uuid7';

const dec = (p, f) => String(p[f]);
const at = (ev) => new Date(Number(ev.block_number) * 1000);
const evKeyOf = (ev) => `${ev.chain_id}:${ev.block_number}:${ev.tx_hash}:${ev.log_index}`;

export async function applyOtherEvent(db, ev, session, mark) {
  const p = ev.payload ?? {};
  switch (ev.name) {
    case 'PlatformRoleGranted':
      await db.collection('platform_roles').updateOne(
        { did_hash: p.didHash, role: p.role },
        { $set: { active: true, event_key: evKeyOf(ev), ...mark } },
        { upsert: true, session },
      );
      return;
    case 'PlatformRoleRevoked':
      await db.collection('platform_roles').updateOne(
        { did_hash: p.didHash, role: p.role },
        { $set: { active: false, event_key: evKeyOf(ev), ...mark } },
        { upsert: true, session },
      );
      return;
    case 'AccessGranted':
      await db.collection('asset_permissions').updateOne(
        { asset_id: dec(p, 'assetId'), grantee_did_hash: p.granteeDidHash },
        {
          $set: {
            permission_mask: Number(p.permissionMask), active: true,
            expires_at: p.expiresAt ? new Date(p.expiresAt) : null, event_key: evKeyOf(ev), ...mark,
          },
        },
        { upsert: true, session },
      );
      await permHistory(db, session, ev, {
        asset_id: dec(p, 'assetId'), grantee: p.granteeDidHash, mask: Number(p.permissionMask), action: 'granted',
      });
      return;
    case 'AccessRevoked':
      await db.collection('asset_permissions').updateOne(
        { asset_id: dec(p, 'assetId'), grantee_did_hash: p.granteeDidHash },
        { $set: { active: false, event_key: evKeyOf(ev), ...mark } },
        { session },
      );
      await permHistory(db, session, ev, {
        asset_id: dec(p, 'assetId'), grantee: p.granteeDidHash, mask: 0, action: 'revoked',
      });
      return;
    case 'AccessClearedOnTransfer':
      await db.collection('asset_permissions').updateMany(
        { asset_id: dec(p, 'assetId'), active: true },
        { $set: { active: false, event_key: evKeyOf(ev), ...mark } },
        { session },
      );
      return;
    case 'MerkleRootUpdated':
      await db.collection('merkle_root_versions').updateOne(
        { did_hash: p.didHash, version: Number(p.version) },
        {
          $setOnInsert: {
            did_hash: p.didHash, version: Number(p.version), root: normalizeHex32(p.root),
            operation_hash: normalizeHex32(p.operationHash), block_number: ev.block_number, tx_hash: ev.tx_hash,
          },
          $set: { finalized: ev.finalized === true },
        },
        { upsert: true, session },
      );
      return;
    case 'InheritanceRuleSet':
      await db.collection('inheritance_rules').updateOne(
        { owner_did_hash: p.ownerDidHash },
        {
          $setOnInsert: { owner_did_hash: p.ownerDidHash },
          $set: {
            default_nominee_did_hash: p.defaultNomineeDidHash, policy_hash: p.policyHash,
            status: 'active', event_key: evKeyOf(ev), ...mark,
          },
        },
        { upsert: true, session },
      );
      for (const o of p.overrides ?? []) {
        await db.collection('inheritance_asset_rules').updateOne(
          { owner_did_hash: p.ownerDidHash, asset_id: String(o.assetId) },
          {
            $setOnInsert: { owner_did_hash: p.ownerDidHash, asset_id: String(o.assetId) },
            $set: { beneficiary_did_hash: o.beneficiaryDidHash, event_key: evKeyOf(ev), ...mark },
          },
          { upsert: true, session },
        );
      }
      return;
    case 'InheritanceActivated':
      await db.collection('inheritance_cases').updateOne(
        { owner_did_hash: p.ownerDidHash, status: { $in: ['PENDING', 'ACTIVATED'] } },
        {
          $setOnInsert: {
            id: uuidv7(), owner_did_hash: p.ownerDidHash, evidence_hash: p.evidenceHash,
            authority_set_version: Number(p.authoritySetVersion ?? 0),
          },
          $set: { status: 'ACTIVATED', activation_event_key: evKeyOf(ev), ...mark },
        },
        { upsert: true, session },
      );
      return;
    case 'InheritanceBatchExecuted':
      await db.collection('inheritance_cases').updateMany(
        { owner_did_hash: p.ownerDidHash, status: 'ACTIVATED' },
        { $set: { status: 'EXECUTED', event_key: evKeyOf(ev), ...mark } },
        { session },
      );
      return;
    case 'InheritanceClosed':
      await db.collection('inheritance_cases').updateMany(
        { owner_did_hash: p.ownerDidHash, status: { $in: ['ACTIVATED', 'EXECUTED'] } },
        { $set: { status: 'CLOSED', event_key: evKeyOf(ev), ...mark } },
        { session },
      );
      return;
    default:
      throw new Error(`unknown event name ${ev.name} (should have been dead-lettered)`);
  }
}

async function permHistory(db, session, ev, { asset_id, grantee, mask, action }) {
  await db.collection('permission_history').updateOne(
    { event_key: evKeyOf(ev) },
    {
      $setOnInsert: {
        id: uuidv7(), asset_id, grantee, mask, action,
        occurred_at: at(ev), canonical: true,
      },
      $set: { finalized: ev.finalized === true },
    },
    { upsert: true, session },
  );
}
