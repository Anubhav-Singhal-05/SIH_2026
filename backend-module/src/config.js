import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const int = (v, d) => (v ? parseInt(v, 10) : d);

const HERE = dirname(fileURLToPath(import.meta.url));
const ATLAS_ENV_PATH = resolve(HERE, '../../database/atlas-credentials.env');

function loadAtlasFile() {
  if (!existsSync(ATLAS_ENV_PATH)) return {};
  const parsed = {};
  for (const raw of readFileSync(ATLAS_ENV_PATH, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    parsed[key] = val;
  }
  return parsed;
}

export function loadConfig() {
  const atlas = loadAtlasFile();
  return {
    port: int(process.env.PORT, 3000),
    chainId: int(process.env.CHAIN_ID, 31337),
    chainRpcUrl: process.env.CHAIN_RPC_URL ?? 'http://127.0.0.1:8545',
    deploymentManifestPath: process.env.DEPLOYMENT_MANIFEST ?? '../blockchain-module/deployments/anvil.json',
    mongoUri: process.env.MONGODB_URI ?? atlas.MONGODB_URI ?? null,
    mongoDbName: process.env.MONGODB_DB_NAME ?? atlas.MONGODB_DB_NAME ?? 'sih26_dev',
    rpId: process.env.RP_ID ?? 'localhost',
    accessTokenTtlSeconds: int(process.env.ACCESS_TTL, 15 * 60),
    sessionFamilyTtlSeconds: int(process.env.SESSION_FAMILY_TTL, 7 * 24 * 3600),
    permitExpirySeconds: int(process.env.PERMIT_EXPIRY, 5 * 60),
    idempotencyTtlSeconds: int(process.env.IDEMPOTENCY_TTL, 24 * 3600),
    uploadMaxBytes: int(process.env.UPLOAD_MAX_BYTES, 100 * 1024 * 1024),
    mimeAllowlist: (process.env.MIME_ALLOWLIST ?? 'application/octet-stream,application/pdf,image/png')
      .split(',')
      .map((s) => s.trim()),
  };
}

