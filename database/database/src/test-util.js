// TEST-SCOPE ONLY helper: creates an ephemeral database (unique name), applies
// all migrations, returns { db, cleanup }. Nothing from this module is ever
// invoked outside the automated test suite — no fixtures are written to the
// real/dev Atlas database during setup.

import { randomUUID } from 'node:crypto';
import { connect, getDb, disconnect } from './db.js';
import { migrateUp } from './migrate.js';

export async function createEphemeralDb() {
  const dbName = `ephemeral_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const client = await connect({ dbNameOverride: dbName });
  const db = await getDb({ dbNameOverride: dbName });
  const applied = await migrateUp(db);
  return {
    db,
    dbName,
    client,
    applied,
    cleanup: async () => {
      await db.dropDatabase();
      await disconnect();
    },
  };
}
