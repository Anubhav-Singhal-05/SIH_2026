// Shared test harness: ephemeral Atlas DB + deterministic in-memory chain.

import { createEphemeralDb } from '@sih/database/test-util';
import { InMemoryProvider } from '../src/chain/provider.js';
import { DEMO_MANIFEST } from '../src/chain/manifest.js';
import { createHash } from 'node:crypto';
import { merkleLeaf } from '@sih/protocol';

const txHashFor = (block, txIndex = 0, logIndex = 0) =>
  '0x' + createHash('sha256').update(`tx:${block}:${txIndex}:${logIndex}`).digest('hex').slice(0, 64);

export const H = (n) => '0x' + String(n).repeat(2).padEnd(64, '0').slice(0, 64);
export const OWNER = H(0x11);
export const GRANTEE = H(0x22);
export const NEW_OWNER = H(0x33);
export const DID = `did:sih:${OWNER.slice(2)}`;

/** Build a fake chain: blocks [start..end] each with hash/parent chain. */
export function makeBlocks(blocks) {
  const map = {};
  const hash = (n) => H(0xb0 + (n % 0x2f));
  for (const n of blocks) {
    map[n] = { hash: hash(n), parentHash: hash(n - 1), timestamp: 1_700_000_000 + n * 12 };
  }
  return map;
}

/**
 * @param {Array<{block:number, txIndex?:number, logIndex?:number, name:string, payload:object, contract?:string, abiVersion?:string}>} events
 * @param {{blocks?: number[], latest?: number, name?: string}} opts
 */
export function makeProvider(events, { blocks = [], latest, name = 'primary' } = {}) {
  const map = makeBlocks(blocks.length ? blocks : events.map((e) => e.block));
  return new InMemoryProvider({
    name,
    blocks: map,
    logs: events.map((e) => ({
      chainId: DEMO_MANIFEST.chainId,
      blockNumber: e.block,
      blockHash: map[e.block]?.hash ?? H(0xb0 + (e.block % 0x2f)),
      parentHash: map[e.block]?.parentHash ?? H(0xb0 + ((e.block - 1 + 0x30) % 0x2f)),
      timestamp: map[e.block]?.timestamp ?? 1_700_000_000,
      txHash: e.txHash ?? txHashFor(e.block, e.txIndex ?? 0, e.logIndex ?? 0),
      txIndex: e.txIndex ?? 0,
      logIndex: e.logIndex ?? 0,
      contract: e.contract ?? 'AssetRegistry',
      abiVersion: e.abiVersion ?? '1',
      name: e.name,
      payload: e.payload,
    })),
    latest: latest ?? Math.max(0, ...blocks, ...events.map((e) => e.block)),
  });
}

export const ev = {
  identityRegistered: (block, didHash = OWNER) => ({
    block, contract: 'IdentityRegistry', name: 'IdentityRegistered',
    payload: { did: `did:sih:${didHash.slice(2)}`, didHash, controller: 'ctrl-1', encryptionKeyHash: H(0x44) },
  }),
  assetRegistered: (block, assetId, ownerDidHash = OWNER, logIndex = 0) => ({
    block, logIndex, name: 'AssetRegistered',
    payload: { assetId: String(assetId), ownerDidHash, documentHash: H(0x55), metadataHash: H(0x66), storageCommitment: H(0x77), version: 1, ciphertextHash: H(0x55), byteSize: 100 },
  }),
  assetTransferred: (block, assetId, from = OWNER, to = NEW_OWNER, logIndex = 1) => ({
    block, logIndex, name: 'AssetTransferred',
    payload: { assetId: String(assetId), fromDidHash: from, toDidHash: to },
  }),
  accessGranted: (block, assetId, grantee = GRANTEE, logIndex = 2) => ({
    block, logIndex, name: 'AccessGranted',
    payload: { assetId: String(assetId), granteeDidHash: grantee, permissionMask: 7 },
  }),
  merkleRootUpdated: (block, didHash = OWNER, version = 1, root = H(0xc1), logIndex = 3) => ({
    block, contract: 'MerkleRootRegistry', name: 'MerkleRootUpdated',
    payload: { didHash, version, root, operationHash: H(0xd1) },
    logIndex,
  }),
  documentVersionUpdated: (block, assetId, version = 2, logIndex = 1) => ({
    block, logIndex, name: 'DocumentVersionUpdated',
    payload: { assetId: String(assetId), version, documentHash: H(0x88), metadataHash: H(0x99), storageCommitment: H(0xaa), ciphertextHash: H(0x88), byteSize: 200 },
  }),
  assetDeactivated: (block, assetId, logIndex = 2) => ({
    block, logIndex, name: 'AssetDeactivated', payload: { assetId: String(assetId) },
  }),
  unknownEvent: (block, logIndex = 9) => ({
    block, logIndex, name: 'FutureOpaqueEventV99', payload: {},
  }),
};

/** leaf hash helper matching the frozen formula for a synthetic asset. */
export function leaf(assetId, ownerDidHash = OWNER, documentVersion = 1) {
  return merkleLeaf({
    assetId: String(assetId), ownerDidHash, documentHash: H(0x55), metadataHash: H(0x66), documentVersion,
  });
}

export async function withEphemeralDb(run) {
  const eph = await createEphemeralDb();
  try {
    return await run(eph.db, eph.client ?? eph.db.client, eph);
  } finally {
    await eph.cleanup();
  }
}
