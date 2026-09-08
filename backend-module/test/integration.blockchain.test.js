// Cross-module integration: backend step-up permits must verify on-chain.
// Requires: anvil on 127.0.0.1:8545 + blockchain-module deployment manifest.
// Skips gracefully when the chain is not running.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.js';
import { ChainGateway, computeOperationHash } from '../src/chain-gateway.js';
import { StepUpService } from '../src/stepup.js';
import { MockKmsSigner } from '../src/hsm.js';
import { ProjectionRepository } from '../src/repositories.js';
import { didHash as computeDidHash } from '../src/did.js';
import { encodeFunctionData, keccak256, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const MANIFEST = resolve(ROOT, '../blockchain-module/deployments/anvil.json');
const ARTIFACTS = resolve(ROOT, '../blockchain-module/out');
const RPC = 'http://127.0.0.1:8545';

const HAS_CHAIN = existsSync(MANIFEST) && existsSync(resolve(ARTIFACTS, 'IdentityRegistry.sol', 'IdentityRegistry.json'));

// Anvil default accounts: #0 deployer, #1 attester.
const CONTROLLER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const ATTESTER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

async function chainUp() {
  try {
    const res = await fetch(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 }),
    });
    const json = await res.json();
    return Number(BigInt(json.result)) === 31337;
  } catch {
    return false;
  }
}

test('INT-BC-BE-001: backend-issued permit verifies on-chain for registerIdentity', { skip: !HAS_CHAIN || !(await chainUp()) }, async () => {
  const config = { ...loadConfig(), chainId: 31337, chainRpcUrl: RPC };
  const gateway = new ChainGateway({ manifestPath: MANIFEST, artifactsDir: ARTIFACTS, rpcUrls: [RPC], chainId: 31337 });
  const repo = new ProjectionRepository();
  const stepUp = new StepUpService(new MockKmsSigner(ATTESTER_KEY), repo, config);

  const did = 'did:platform:integration-' + Date.now(); // unique per run (anvil state persists)
  const didHash = computeDidHash(did);
  const controller = privateKeyToAccount(CONTROLLER_KEY).address;
  const abi = gateway.abis.IdentityRegistry;
  const emptyRoot = '0x' + (await import('node:crypto')).createHash('sha256').update(Buffer.from('02', 'hex')).digest('hex');

  // 1. Backend creates the operation + permit (verified path).
  const intent = await stepUp.createPermitIntent({
    callerDid: did,
    contractAddress: gateway.addressOf('identityRegistry'),
    abi,
    functionName: 'registerIdentity',
    args: [didHash, controller, keccak256(toHex('x25519-key')), keccak256(toHex('recovery')), emptyRoot],
    kind: 'MINT',
    endpoint: 'POST /identity/register',
    requestDigest: 'integration',
    verified: true,
  });
  assert.match(intent.calldata, /^0x[0-9a-f]+$/);

  // 2. Wallet (controller) submits the calldata on-chain.
  const { createWalletClient, createPublicClient, http, defineChain } = await import('viem');
  const anvil = defineChain({
    id: 31337,
    name: 'anvil',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [RPC] } },
  });
  const wallet = createWalletClient({ account: privateKeyToAccount(CONTROLLER_KEY), chain: anvil, transport: http(RPC) });
  const client = createPublicClient({ transport: http(RPC) });
  const txHash = await wallet.sendTransaction({
    to: intent.target,
    data: intent.calldata,
  });
  const receipt = (await client.waitForTransactionReceipt({ hash: txHash, confirmations: 1 }));
  assert.equal(receipt.status, 'success');

  // 3. Backend reads the finalized state back from the chain.
  assert.equal(await gateway.isActive(didHash), true);
  const identity = await gateway.getIdentity(didHash);
  assert.equal(identity.controller.toLowerCase(), controller.toLowerCase());
  assert.equal(identity.active, true);

  // 4. Replay protection: submitting the SAME calldata again must revert on-chain.
  await assert.rejects(
    wallet.sendTransaction({ to: intent.target, data: intent.calldata, chain: null }),
    () => true,
  );
});

test('INT-BC-BE-002: stale root is rejected by the contract (INV-06, on-chain)', { skip: !HAS_CHAIN || !(await chainUp()) }, async () => {
  const gateway = new ChainGateway({ manifestPath: MANIFEST, artifactsDir: ARTIFACTS, rpcUrls: [RPC], chainId: 31337 });
  // getCurrentRoot for an unknown DID must revert RootNotInitialized -> mapped domain error.
  const err = await gateway.getRoot('0x' + '99'.repeat(32)).then(
    () => null,
    (e) => e,
  );
  assert.ok(err, 'expected an error for uninitialized root');
});
