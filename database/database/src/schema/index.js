import { VALIDATORS } from './validators.js';
import { VALIDATORS_2 } from './validators2.js';
import { VALIDATORS_2B } from './validators2b.js';
import { VALIDATORS_3 } from './validators3.js';
import { INDEXES, COLLECTIONS } from './indexes.js';

export const ALL_VALIDATORS = { ...VALIDATORS, ...VALIDATORS_2, ...VALIDATORS_2B, ...VALIDATORS_3 };
export { INDEXES, COLLECTIONS };

/**
 * Create a collection with its validator and indexes. Used by migrations only —
 * application code must never call this at startup (DB-SCHEMA-005).
 */
export async function ensureCollection(db, name, { skipIndexes = false } = {}) {
  const validator = ALL_VALIDATORS[name];
  if (!validator) throw new Error(`no validator defined for collection ${name}`);
  const exists = await db.listCollections({ name }).hasNext();
  if (!exists) {
    await db.createCollection(name, { validator: { $jsonSchema: validator }, validationLevel: 'strict' });
  } else {
    await db.command({ collMod: name, validator: { $jsonSchema: validator }, validationLevel: 'strict' });
  }
  if (!skipIndexes) {
    const specs = (INDEXES[name] ?? []).map(([key, opts]) => ({ key, ...opts }));
    if (specs.length) await db.collection(name).createIndexes(specs);
  }
}
