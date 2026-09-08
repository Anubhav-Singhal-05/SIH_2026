import { createHash } from 'node:crypto';
import { createPublicClient, http, decodeFunctionResult, encodeFunctionData, encodeAbiParameters, keccak256 } from 'viem';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DomainError, ErrorCode, CONTRACT_ERROR_MAP } from './errors.js';

/**
 * ChainGateway (spec §5). Typed reads against deployed contracts, calldata
 * encoding, custom-revert mapping. ABI JSON is loaded from the blockchain
 * module build artifacts — no handwritten ABI strings in feature modules
 * (BE-CHAIN-009).
 */
export class ChainGateway {
  constructor({ manifestPath, artifactsDir, rpcUrls, chainId }) {
    this.manifest = JSON.parse(readFileSync(resolve(manifestPath), 'utf8'));
    this.chainId = Number(this.manifest.chainId);
    if (this.chainId !== chainId) {
      throw new DomainError(ErrorCode.WRONG_NETWORK, `manifest chain ${this.chainId} != configured ${chainId}`);
    }
    this.abis = {
      IdentityRegistry: loadAbi(artifactsDir, 'IdentityRegistry'),
      AssetRegistry: loadAbi(artifactsDir, 'AssetRegistry'),
      AssetAccessRegistry: loadAbi(artifactsDir, 'AssetAccessRegistry'),
      MerkleRootRegistry: loadAbi(artifactsDir, 'MerkleRootRegistry'),
    };
    this.clients = rpcUrls.map(
      (url) => createPublicClient({ transport: http(url, { timeout: 5000, retryCount: 0 }) }),
    );
  }

  addressOf(contract) {
    const key = this.manifest[contract] !== undefined ? contract
      : contract.charAt(0).toLowerCase() + contract.slice(1);
    return this.manifest[key];
  }

  async #read(contract, fn, args) {
    const abi = this.abis[contract];
    if (!abi) throw new DomainError(ErrorCode.INTERNAL_ERROR, 'no ABI for contract');
    const data = encodeFunctionData({ abi, functionName: fn, args });
    let lastError;
    for (const client of this.clients) {
      try {
        const result = await client.call({ to: this.addressOf(contract), data });
        if (!result.data) throw new Error('empty result');
        return decodeFunctionResult({ abi, functionName: fn, data: result.data });
      } catch (err) {
        lastError = err;
      }
    }
    throw this.toDomainError(lastError);
  }

  async isActive(didHash) {
    return this.#read('IdentityRegistry', 'isActive', [didHash]);
  }

  async getIdentity(didHash) {
    const controller = await this.#read('IdentityRegistry', 'controllerOf', [didHash]);
    const active = await this.#read('IdentityRegistry', 'isActive', [didHash]);
    return { controller, active };
  }

  async getAsset(assetId) {
    const a = await this.#read('AssetRegistry', 'getAsset', [assetId]);
    return {
      ownerDidHash: a.ownerDid,
      documentHash: a.documentHash,
      metadataHash: a.metadataHash,
      documentVersion: BigInt(a.documentVersion),
      status: a.status,
    };
  }

  async getPermission(assetId, granteeDidHash) {
    return this.#read('AssetAccessRegistry', 'getPermission', [assetId, granteeDidHash]);
  }

  async getRoot(didHash) {
    const r = await this.#read('MerkleRootRegistry', 'getCurrentRoot', [didHash]);
    return { root: r[0], version: r[1] };
  }

  encodeCalldata(contract, fn, args) {
    return encodeFunctionData({ abi: this.abis[contract], functionName: fn, args });
  }

  /** Maps contract reverts to domain errors; unknown reverts map to CONTRACT_REVERTED. */
  decodeRevert(err) {
    if (err instanceof DomainError) return err;
    const message = err instanceof Error ? err.message : String(err);
    for (const [name, code] of Object.entries(CONTRACT_ERROR_MAP)) {
      if (message.includes(name)) return new DomainError(code, `contract reverted: ${name}`);
    }
    return new DomainError(ErrorCode.CONTRACT_REVERTED, 'contract reverted');
  }

  toDomainError(err) {
    const message = err instanceof Error ? err.message : String(err);
    for (const [name, code] of Object.entries(CONTRACT_ERROR_MAP)) {
      if (message.includes(name)) return new DomainError(code, `contract reverted: ${name}`);
    }
    return new DomainError(ErrorCode.CHAIN_UNAVAILABLE, 'all providers unreachable', { cause: message.slice(0, 200) });
  }

  async getReceipt(txHash) {
    try {
      const receipt = await this.clients[0].getTransactionReceipt(txHash);
      return receipt.status === 'success'
        ? { state: 'success', blockNumber: receipt.blockNumber }
        : { state: 'failed', blockNumber: receipt.blockNumber };
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message.includes('not found') || message.includes('not been mined')) return { state: 'pending' };
      return { state: 'unknown' };
    }
  }
}

function loadAbi(artifactsDir, name) {
  const artifact = JSON.parse(readFileSync(resolve(artifactsDir, `${name}.sol`, `${name}.json`), 'utf8'));
  return artifact.abi;
}

/**
 * operation hash — byte-compatible with blockchain-module/src/Protocol.sol
 * OperationHash.compute (BC-DEPLOY-012 golden vectors):
 * keccak256(abi.encode(chainId, target, selector, didHash, nonce, expiresAt, keccak256(args)))
 */
export function computeOperationHash(chainId, target, selector, didHash, nonce, expiresAt, canonicalArgs) {
  const argsHash = keccak256(canonicalArgs);
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'uint256' },
        { type: 'address' },
        { type: 'bytes4' },
        { type: 'bytes32' },
        { type: 'uint64' },
        { type: 'uint64' },
        { type: 'bytes32' },
      ],
      [chainId, target, selector, didHash, nonce, expiresAt, argsHash],
    ),
  );
}

export function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}
