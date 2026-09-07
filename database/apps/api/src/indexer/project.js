// Event projection engine — strict (block, tx_index, log_index) ordering, one
// DB transaction per block, provisional-until-final flags. Duplicate delivery
// is a no-op thanks to unique event keys and idempotent upsert semantics.

import { uuidv7 } from '@sih/database/uuid7';
import { applyIdentityAndAssetEvent } from './handlers.js';
import { applyOtherEvent } from './handlers2.js';

export function evKey(ev) {
  return `${ev.chain_id}:${ev.block_number}:${ev.tx_hash}:${ev.log_index}`;
}

/**
 * Apply a single event's documented projection effect inside `session`.
 * Every write is idempotent for the same event key (reorg replay safety).
 */
export async function applyEvent(db, ev, session) {
  const mark = { finalized: ev.finalized === true };
  if (['IdentityRegistered', 'IdentityControllerRotated', 'IdentityStatusChanged',
    'AssetRegistered', 'DocumentVersionUpdated', 'AssetTransferred', 'AssetDeactivated'].includes(ev.name)) {
    await applyIdentityAndAssetEvent(db, ev, session, mark);
  } else {
    await applyOtherEvent(db, ev, session, mark);
  }
}

/** Stable sort key: (block_number, tx_index, log_index). */
export function sortKey(ev) {
  return ev.block_number * 2n ** 48n + BigInt(ev.tx_index ?? 0) * 2n ** 24n + BigInt(ev.log_index);
}

export async function processBlock(db, client, blockNumber, events, outbox, processed) {
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      for (const ev of events) {
        await applyEvent(db, ev, session);
        processed.push(evKey(ev));
      }
      await db.collection('indexer_state').updateOne(
        { _id: `progress:block:${blockNumber}` },
        { $set: { projected: true, count: events.length } },
        { upsert: true, session },
      );
      // Outbox rows are written INSIDE the transaction; the notifier publishes
      // only rows whose projection transaction committed (never on rollback).
      if (outbox) {
        for (const ev of events) {
          await db.collection('event_outbox').updateOne(
            { event_key: evKey(ev) },
            { $setOnInsert: { event_key: evKey(ev), name: ev.name, block_number: ev.block_number, payload: ev.payload, published: false, created_at: new Date() } },
            { upsert: true, session },
          );
        }
      }
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
  } finally {
    await session.endSession();
  }
}

/**
 * Project all canonical, non-dead-letter events up to `toBlock`, in strict
 * order, one DB transaction per block. Pages from providers are re-sorted by
 * the (block, tx_index, log_index) sort key before projection.
 */
export async function projectEvents(db, client, toBlock, { outbox } = {}) {
  const processed = [];
  const cursor = db.collection('chain_events').find({
    block_number: { $lte: toBlock },
    canonical: true,
    dead_letter: false,
  }).sort({ block_number: 1, tx_index: 1, log_index: 1 });

  let currentBlock = null;
  let batch = [];
  for await (const ev of cursor) {
    if (currentBlock === null) currentBlock = ev.block_number;
    if (ev.block_number !== currentBlock) {
      await processBlock(db, client, currentBlock, batch, outbox, processed);
      batch = [];
      currentBlock = ev.block_number;
    }
    batch.push(ev);
  }
  if (currentBlock !== null) {
    await processBlock(db, client, currentBlock, batch, outbox, processed);
  }
  return processed;
}

/** Publish committed outbox rows only (post-commit), then mark them published. */
export async function publishOutbox(db, publish = async () => {}) {
  const rows = await db.collection('event_outbox').find({ published: false }).sort({ block_number: 1 }).toArray();
  for (const row of rows) {
    await publish(row); // strictly after the projection transaction committed
    await db.collection('event_outbox').updateOne({ _id: row._id }, { $set: { published: true, published_at: new Date() } });
  }
  return rows.length;
}
