// MongoDB Atlas connection. Application code NEVER changes schema at
// startup (DB-SCHEMA-005) — this module only connects.

import { MongoClient } from 'mongodb';
import { connectionConfig } from './env.js';

let client = null;

export async function connect({ dbNameOverride } = {}) {
  if (client) return client;
  const { mongoUri, dbName } = connectionConfig({ dbNameOverride });
  client = new MongoClient(mongoUri, {
    appName: 'sih26-database-layer',
    retryWrites: true,
    retryReads: true,
    w: 'majority',
    serverSelectionTimeoutMS: 30_000,
    connectTimeoutMS: 30_000,
    socketTimeoutMS: 180_000,
    heartbeatFrequencyMS: 10_000,
    maxIdleTimeMS: 0,
  });
  await client.connect();
  client.s.options.dbName = dbName; // default db for .db() calls
  return client;
}

export async function getDb({ dbNameOverride } = {}) {
  const c = await connect({ dbNameOverride });
  return dbNameOverride ? c.db(dbNameOverride) : c.db();
}

export async function disconnect() {
  if (client) {
    await client.close();
    client = null;
  }
}
