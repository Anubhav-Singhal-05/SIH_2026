// Forward-only migration runner (DB-SCHEMA-003/004).
// - Migrations apply in lexical file order, each recording an entry in
//   `schema_migrations` with its documented index impact.
// - `down` is NEVER executed; every migration documents a rollback-safe
//   deployment procedure (a compensating, human-approved operation), which is
//   the agreed forward-only convention.
// - Application code never invokes schema changes at startup.

import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const CHANGELOG = 'schema_migrations';

export async function listMigrations(dir = MIGRATIONS_DIR) {
  const files = (await readdir(dir)).filter((f) => /^\d{4}_.*\.js$/.test(f)).sort();
  return files.map((f) => path.join(dir, f));
}

async function loadMigration(file) {
  const mod = await import(pathToFileURL(file).href);
  if (typeof mod.up !== 'function') throw new Error(`${file} has no up()`);
  if (!mod.description || !mod.indexImpact) throw new Error(`${file} must document description and indexImpact`);
  return mod;
}

export async function appliedMap(db) {
  const docs = await db.collection(CHANGELOG).find({}).toArray();
  return new Map(docs.map((d) => [d._id, d]));
}

export async function status(db) {
  const files = await listMigrations();
  const applied = await appliedMap(db);
  return files.map((file) => {
    const id = path.basename(file, '.js');
    return { id, applied: applied.has(id), appliedAt: applied.get(id)?.applied_at ?? null };
  });
}

export async function migrateUp(db, { onStep } = {}) {
  const files = await listMigrations();
  const applied = await appliedMap(db);
  const results = [];
  for (const file of files) {
    const id = path.basename(file, '.js');
    if (applied.has(id)) continue;
    const mod = await loadMigration(file);
    const source = await readFile(file, 'utf8');
    const hash = createHash('sha256').update(source).digest('hex');
    await mod.up(db);
    await db.collection(CHANGELOG).insertOne({
      _id: id,
      description: mod.description,
      indexImpact: mod.indexImpact,
      hash,
      applied_at: new Date(),
    });
    results.push(id);
    onStep?.(id);
  }
  return results;
}

// CLI entry: `node src/migrate.js up|status`
if (process.argv[1] && process.argv[1].endsWith('migrate.js')) {
  const cmd = process.argv[2] ?? 'status';
  const { connect } = await import('./db.js');
  const { getDb, disconnect } = await import('./db.js');
  const client = await connect();
  const db = await getDb();
  if (cmd === 'up') {
    const applied = await migrateUp(db, { onStep: (id) => console.log(`applied ${id}`) });
    console.log(applied.length ? `applied ${applied.length} migration(s)` : 'database up to date');
  } else {
    for (const s of await status(db)) console.log(`${s.applied ? '[x]' : '[ ]'} ${s.id}`);
  }
  await disconnect().catch(() => client.close());
}
