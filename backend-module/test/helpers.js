import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { ProjectionRepository } from '../src/repositories.js';
import { LocalStorageService } from '../src/storage.js';
import { AuthService } from '../src/auth.js';
import { StepUpService } from '../src/stepup.js';
import { MockKmsSigner } from '../src/hsm.js';
import { AssetsService } from '../src/assets.js';
import { AuditRepository } from '../src/audit.js';
import { ErrorCode, DomainError, CONTRACT_ERROR_MAP, sha256Hex } from '../src/errors.js';
import { normalizeDid, didHash, requestDigest } from '../src/did.js';
import { EMPTY_ROOT, leaf, parent, rootOf } from '../src/merkle.js';
import { computeOperationHash } from '../src/chain-gateway.js';
import { keccak256, toHex } from 'viem';

export const ATTESTER_KEY = '0x' + 'ac'.repeat(32);
export const ALICE_DID = 'did:platform:alice';
export const BOB_DID = 'did:platform:bob';

/** Stub ChainGateway standing in for the live RPC adapter (cross-team mock). */
export class StubChainGateway {
  constructor() {
    this.abis = {
      AssetRegistry: [
        {
          type: 'function',
          name: 'registerAsset',
          stateMutability: 'nonpayable',
          inputs: [
            { name: 'assetId', type: 'uint256' },
            { name: 'ownerDid', type: 'bytes32' },
            { name: 'documentHash', type: 'bytes32' },
            { name: 'metadataHash', type: 'bytes32' },
            { name: 'storageRefCommitment', type: 'bytes32' },
            { name: 'oldRoot', type: 'bytes32' },
            { name: 'newRoot', type: 'bytes32' },
            { name: 'rootVersion', type: 'uint64' },
            {
              name: 'permit',
              type: 'tuple',
              components: [
                { name: 'operationHash', type: 'bytes32' },
                { name: 'didHash', type: 'bytes32' },
                { name: 'expiresAt', type: 'uint64' },
                { name: 'nonce', type: 'uint64' },
                { name: 'signature', type: 'bytes' },
              ],
            },
          ],
          outputs: [],
        },
      ],
    };
    this.roots = new Map();
  }

  addressOf(name) {
    return '0x' + String(name.length).padStart(40, '1');
  }

  async getRoot(didHash) {
    return this.roots.get(didHash.toLowerCase()) ?? { root: '0x' + '00'.repeat(32), version: 0n };
  }
}

export async function makeFixture() {
  const config = { ...loadConfig(), chainId: 31337 };
  const repo = new ProjectionRepository();
  const storage = new LocalStorageService(mkdtempSync(join(tmpdir(), 'bmod-')), 60);
  const audit = new AuditRepository();
  const auth = new AuthService(config);
  const hsm = new MockKmsSigner(ATTESTER_KEY);
  const stepUp = new StepUpService(hsm, repo, config);
  const chain = new StubChainGateway();
  const assets = new AssetsService(repo, storage, chain, stepUp, config);
  return { config, repo, storage, audit, auth, hsm, stepUp, chain, assets };
}

export { test, assert, ErrorCode, DomainError, CONTRACT_ERROR_MAP, sha256Hex, normalizeDid, didHash, requestDigest, EMPTY_ROOT, leaf, parent, rootOf, computeOperationHash, keccak256, toHex };
