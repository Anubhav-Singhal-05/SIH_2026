// Loads Atlas credentials from the standard `atlas-credentials.env` file at
// the repository root, using the default/standard MongoDB Atlas variable
// names (MONGODB_URI / MONGODB_DB_NAME, plus MONGODB_USERNAME / MONGODB_PASSWORD
// as emitted by Atlas onboarding). Never hardcode credentials in source.
//
// Precedence: real process env wins over the file (12-factor friendly).

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CREDENTIALS_PATH = path.join(ROOT, 'atlas-credentials.env');

export function loadAtlasEnv(env = process.env, file = CREDENTIALS_PATH) {
  const parsed = {};
  if (existsSync(file)) {
    for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      parsed[key] = value;
    }
  }
  const get = (name, fallback) => env[name] ?? parsed[name] ?? fallback;
  return {
    mongoUri: get('MONGODB_URI', get('ATLAS_URI', null)),
    mongoDbName: get('MONGODB_DB_NAME', 'sih26'),
    mongoUsername: get('MONGODB_USERNAME', null),
    mongoPassword: get('MONGODB_PASSWORD', null),
  };
}

/** Connection config, with an optional per-process DB-name override for ephemeral test databases. */
export function connectionConfig({ dbNameOverride } = {}) {
  const { mongoUri, mongoDbName, mongoUsername, mongoPassword } = loadAtlasEnv();
  if (!mongoUri) throw new Error('MONGODB_URI missing: expected in atlas-credentials.env or environment');
  if (mongoUri.includes('://') && /:\/\/[^/@]*@/.test(mongoUri) === false && mongoUsername && mongoPassword) {
    // URI without inline credentials: inject them (standard srv form)
  }
  return { mongoUri, dbName: dbNameOverride ?? mongoDbName };
}
