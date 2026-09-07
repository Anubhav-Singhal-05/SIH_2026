// Fixture DEFINITIONS used exclusively by the automated test suite
// (ephemeral test databases only). These are builders — they are NEVER run
// against the real/dev Atlas database as part of setup.

import { uuidv7 } from '../src/uuid7.js';

const h = (n) => '0x' + String(n).repeat(2).padEnd(64, '0').slice(0, 64);
export const H1 = h(0x11), H2 = h(0x22), H3 = h(0x33), H4 = h(0x44), H5 = h(0x55);
export const TX1 = h(0xa1), TX2 = h(0xa2);
export const MAX_UINT128 = '340282366920938463463374607431768211455';
export const MAX_UINT256 = '115792089237316195423570985008687907853269984665640564039457584007913129639935';

export const fixture = {
  chainBlock: (block, overrides = {}) => ({
    chain_id: 31337, block_number: block, block_hash: h(0xb0 + (block % 0x2f)), parent_hash: h(0xb0 + ((block - 1 + 0x30) % 0x2f)),
    timestamp: new Date(), finalized: false, canonical: true, ...overrides,
  }),
  chainEvent: ({ block, logIndex = 0, txIndex = 0, name, payload, ...rest }) => ({
    chain_id: 31337, tx_hash: TX1, log_index: logIndex, tx_index: txIndex, block_number: block,
    contract: 'AssetRegistry', abi_version: '1', name, payload: payload ?? {}, finalized: false, canonical: true,
    dead_letter: false, dead_letter_reason: null, ...rest,
  }),
  identity: (overrides = {}) => ({
    id: uuidv7(), did: `did:sih:${h(0x1).slice(2)}`, did_hash: H1, controller: '0xcontroller-1',
    encryption_key_hash: H3, recovery_config_hash: null, status: 'active', event_key: 'ev:1', ...overrides,
  }),
  identityKey: (identityId, overrides = {}) => ({
    id: uuidv7(), identity_id: identityId, key_type: 'encryption', public_key_hash: H3,
    active_from: new Date(), active_to: null, ...overrides,
  }),
  asset: (assetId, overrides = {}) => ({
    asset_id: String(assetId), owner_did_hash: H1, status: 'active', document_hash: H2, metadata_hash: H3,
    storage_commitment: H4, current_version: 1, event_key: `ev:asset:${assetId}`, finalized: true, ...overrides,
  }),
  ownership: (assetId, overrides = {}) => ({
    id: uuidv7(), asset_id: String(assetId), from_did_hash: null, to_did_hash: H1, cause: 'registered',
    event_key: `ev:reg:${assetId}`, occurred_at: new Date(), canonical: true, ...overrides,
  }),
  documentVersion: (assetId, version = 1, overrides = {}) => ({
    id: uuidv7(), asset_id: String(assetId), version, document_hash: H2, metadata_hash: H3, storage_commitment: H4,
    ciphertext_hash: H5, byte_size: 1024, status: 'confirmed', finalized: true, ...overrides,
  }),
  storageObject: (documentVersionId, overrides = {}) => ({
    id: uuidv7(), document_version_id: documentVersionId, provider: 'ipfs-cluster',
    encrypted_object_ref: 'vault://cluster/obj/enc-abc123', ciphertext_checksum: H5, state: 'STAGED',
    retention_until: null, confirmed_at: null, staged_at: new Date(), legal_hold: false, ...overrides,
  }),
  permission: (assetId, grantee = H2, overrides = {}) => ({
    asset_id: String(assetId), grantee_did_hash: grantee, permission_mask: 7, expires_at: null, active: true,
    event_key: `ev:grant:${assetId}:${grantee.slice(2, 10)}`, ...overrides,
  }),
  rootVersion: (didHash = H1, version = 1, overrides = {}) => ({
    did_hash: didHash, version, root: h(0xc0 + version), operation_hash: h(0xd0 + version),
    block_number: 100 + version, tx_hash: TX1, finalized: true, ...overrides,
  }),
  leafSnapshot: (didHash, rootVersion, assetId, ordinal, overrides = {}) => ({
    did_hash: didHash, root_version: rootVersion, asset_id: String(assetId), leaf_hash: h(0xe0 + (ordinal % 0x2f)),
    ordinal, root: h(0xc0 + rootVersion), created_at: new Date(), ...overrides,
  }),
};
