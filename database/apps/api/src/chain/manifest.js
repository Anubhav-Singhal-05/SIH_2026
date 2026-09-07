// Deployment manifest â€” the immutable record of where ingestion starts and
// what ABI versions are legal (DB-INDEX-001, DB-INDEX-004).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DEFAULT_MANIFEST_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'config', 'deployment-manifest.json',
);

/** @typedef {{chainId:number, deploymentBlock:number, abiVersion:string, contracts:string[], confirmationDepth:number}} DeploymentManifest */

/**
 * Load + validate a deployment manifest. Ingestion must start at
 * `deploymentBlock` â€” never 0, never "latest".
 */
export function loadManifest(file = DEFAULT_MANIFEST_PATH) {
  const m = JSON.parse(readFileSync(file, 'utf8'));
  assertManifest(m);
  return m;
}

export function assertManifest(m) {
  for (const key of ['chainId', 'deploymentBlock', 'abiVersion', 'contracts', 'confirmationDepth']) {
    if (m[key] === undefined) throw new Error(`deployment manifest missing ${key}`);
  }
  if (!Number.isInteger(m.chainId) || m.chainId <= 0) throw new Error('manifest chainId must be a positive integer');
  if (!Number.isInteger(m.deploymentBlock) || m.deploymentBlock < 0) {
    throw new Error('manifest deploymentBlock must be a non-negative integer (never "latest")');
  }
  if (!Array.isArray(m.contracts) || m.contracts.length === 0) throw new Error('manifest contracts must be a non-empty list');
  if (!Number.isInteger(m.confirmationDepth) || m.confirmationDepth < 0) throw new Error('manifest confirmationDepth must be an integer >= 0');
  return m;
}

export const DEMO_MANIFEST = {
  chainId: 31337,
  deploymentBlock: 1, // frozen at deploy time; the indexer refuses to start elsewhere
  abiVersion: '1',
  contracts: ['IdentityRegistry', 'AssetRegistry', 'AssetAccessRegistry', 'MerkleRootRegistry', 'InheritanceRegistry'],
  confirmationDepth: 12,
};
