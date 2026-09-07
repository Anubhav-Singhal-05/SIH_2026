// Migration 0001 — raw chain event ledger (one bounded concern: the immutable
// ingestion ledger). Creates chain_blocks + chain_events with validators and
// indexes. Index impact: uq_block_hash, uq_chain_block, uq_tx_log,
// ix_events_finalized_block_log, ix_events_dead_letter.
//
// Rollback-safe deployment procedure (documented, forward-only — never
// auto-executed): if this migration must be abandoned post-deploy, gate writes
// to the ledger via the indexer feature flag, then drop the two collections in
// a maintenance window; raw logs are always re-derivable from provider archive
// access from the deployment block (spec §9).

import { ensureCollection } from '../src/schema/index.js';

export const description = 'create raw chain ledger (chain_blocks, chain_events)';
export const indexImpact = 'adds unique (block_hash), (chain_id, block_number), (chain_id, tx_hash, log_index); adds (finalized, block_number, log_index), dead-letter partial index';

export async function up(db) {
  await ensureCollection(db, 'chain_blocks');
  await ensureCollection(db, 'chain_events');
}
