import { randomUUID } from 'node:crypto';
import { encodeFunctionData, hashTypedData, getFunctionSelector, domainSeparator } from 'viem';
import { didHash as computeDidHash } from './did.js';
import { computeOperationHash } from './chain-gateway.js';

const DOMAIN = { name: 'BlockchainIdentityAssetPlatform', version: '1' };

const PERMIT_TYPES = {
  StepUpPermit: [
    { name: 'operationHash', type: 'bytes32' },
    { name: 'didHash', type: 'bytes32' },
    { name: 'expiresAt', type: 'uint64' },
    { name: 'nonce', type: 'uint64' },
  ],
};

/**
 * Step-up permit issuance (BE-STEPUP-001..012). The operation digest and the
 * EIP-712 domain are byte-compatible with the blockchain module's Permitted
 * contract, so issued permits verify on-chain.
 */
export class StepUpService {
  constructor(hsm, repo, config) {
    this.hsm = hsm;
    this.repo = repo;
    this.config = config;
  }

  permitDomain(verifyingContract) {
    return { ...DOMAIN, chainId: this.config.chainId, verifyingContract };
  }

  /**
   * Creates an operation (AWAITING_STEP_UP), computes the operation digest
   * over normalized canonical args, and — once user verification is attested —
   * signs the permit through the HSM and returns calldata.
   */
  async createPermitIntent(input) {
    const callerDidHash = computeDidHash(input.callerDid);
    // Canonical args are hashed WITHOUT the permit parameter (the permit binds
    // the args, not vice versa). The selector comes from the full ABI.
    const selector = getFunctionSelector(input.abi, input.functionName);
    const canonicalArgs = encodeFunctionData({
      abi: stripPermitAbi(input.abi, input.functionName),
      functionName: input.functionName,
      args: input.args,
    });

    const nonce = BigInt(Date.now()) % (1n << 64n);
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + this.config.permitExpirySeconds);
    const operationHash = computeOperationHash(
      BigInt(this.config.chainId),
      input.contractAddress,
      selector,
      callerDidHash,
      nonce,
      expiresAt,
      canonicalArgs,
    );

    const operationId = randomUUID();
    const op = {
      operationId,
      callerDidHash,
      kind: input.kind,
      endpoint: input.endpoint,
      requestDigest: input.requestDigest,
      status: 'AWAITING_STEP_UP',
      permitNonce: nonce,
      permitDigest: operationHash,
      permitExpiresAt: Number(expiresAt),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await this.repo.saveOperation(op);

    if (!input.verified) {
      // The client must complete a WebAuthn user-verification challenge bound
      // to the operation digest before the permit is signed (BE-STEPUP-004).
      return {
        operationId,
        permit: { operationHash, didHash: callerDidHash, expiresAt, nonce, signature: '0x' },
        calldata: '0x',
        target: input.contractAddress,
      };
    }

    const permit = await this.#signPermit(operationHash, callerDidHash, expiresAt, nonce, input.contractAddress);
    const calldata = encodeFunctionData({
      abi: input.abi,
      functionName: input.functionName,
      args: appendPermitArg(input.abi, input.functionName, input.args, permit),
    });
    op.status = 'AWAITING_WALLET_SIGNATURE';
    await this.repo.saveOperation(op);
    return { operationId, permit, calldata, target: input.contractAddress };
  }

  async #signPermit(operationHash, didHash, expiresAt, nonce, verifyingContract) {
    const digest = hashTypedData({
      domain: this.permitDomain(verifyingContract),
      types: PERMIT_TYPES,
      primaryType: 'StepUpPermit',
      message: { operationHash, didHash, expiresAt, nonce },
    });
    const sig = await this.hsm.signDigest(digest);
    const r = sig.r.toString(16).padStart(64, '0');
    const s = sig.s.toString(16).padStart(64, '0');
    const v = sig.v.toString(16).padStart(2, '0');
    return { operationHash, didHash, expiresAt, nonce, signature: '0x' + r + s + v };
  }
}

function appendPermitArg(abi, fn, args, permit) {
  const fragment = abi.find((f) => f.name === fn);
  if (!fragment) throw new Error('unknown function: ' + fn);
  const needsPermit = fragment.inputs.some((i) => (i.name ?? '').startsWith('permit'));
  return needsPermit ? [...args, permit] : args;
}

/** ABI copy with the permit parameter removed from `fn` (canonical-args hashing). */
function stripPermitAbi(abi, fn) {
  return abi.map((item) => {
    if (item.type === 'function' && item.name === fn) {
      return {
        ...item,
        inputs: item.inputs.filter((i) => !(i.name ?? '').startsWith('permit')),
      };
    }
    return item;
  });
}

export { domainSeparator };
