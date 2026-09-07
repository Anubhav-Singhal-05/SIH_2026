// Raw ledger ingestion — idempotent storage of blocks/events, dead-letter for
// unknown ABI events (DB-INDEX-003, DB-INDEX-004).

import { normalizeHex32 } from '@sih/protocol';

/**
 * Store blocks and raw events idempotently. Re-fetch of the same range never
 * duplicates rows (upsert on natural keys).
 */
export async function storeRawLogs(db, logs, { contract } = {}) {
  if (logs.length === 0) return { blocks: 0, events: 0 };
  let blocks = 0, events = 0;
  const seenBlocks = new Set();
  for (const log of logs) {
    if (!seenBlocks.has(log.blockNumber)) {
      seenBlocks.add(log.blockNumber);
      const chainId = log.chainId ?? 31337;
      const r = await db.collection('chain_blocks').updateOne(
        { chain_id: chainId, block_number: log.blockNumber },
        {
          $setOnInsert: {
            chain_id: chainId,
            block_number: log.blockNumber,
            block_hash: normalizeHex32(log.blockHash),
            parent_hash: normalizeHex32(log.parentHash),
            timestamp: new Date(log.timestamp * 1000),
            finalized: false,
            canonical: true,
          },
        },
        { upsert: true },
      );
      blocks += r.upsertedCount;
    }
  }
  for (const log of logs) {
    const chainId = log.chainId ?? 31337;
    const r = await db.collection('chain_events').updateOne(
      { chain_id: chainId, tx_hash: normalizeHex32(log.txHash), log_index: log.logIndex },
      {
        $setOnInsert: {
          chain_id: chainId,
          tx_hash: normalizeHex32(log.txHash),
          log_index: log.logIndex,
          tx_index: log.txIndex ?? 0,
          block_number: log.blockNumber,
          contract: log.contract ?? contract ?? 'unknown',
          abi_version: log.abiVersion ?? '1',
          name: log.name,
          payload: log.payload ?? {},
          finalized: false,
          canonical: true,
          dead_letter: false,
          dead_letter_reason: null,
        },
      },
      { upsert: true },
    );
    events += r.upsertedCount;
  }
  return { blocks, events };
}

/** Known ABI version gate: unknown versions enter dead-letter state (no crash, no silent drop). */
export const KNOWN_ABI_VERSIONS = new Set(['1']);

export const KNOWN_EVENT_NAMES = new Set([
  'IdentityRegistered', 'IdentityControllerRotated', 'IdentityStatusChanged',
  'AssetRegistered', 'DocumentVersionUpdated', 'AssetTransferred', 'AssetDeactivated',
  'PlatformRoleGranted', 'PlatformRoleRevoked',
  'AccessGranted', 'AccessRevoked', 'AccessClearedOnTransfer',
  'MerkleRootUpdated',
  'InheritanceRuleSet', 'InheritanceActivated', 'InheritanceBatchExecuted', 'InheritanceClosed',
]);

/** Mark unknown-ABI / unknown-name events as dead-lettered and return an alert record. */
export async function deadLetterUnknown(db) {
  const cursor = db.collection('chain_events').find({ dead_letter: false, canonical: true });
  const alerts = [];
  for await (const ev of cursor) {
    const bad = !KNOWN_ABI_VERSIONS.has(ev.abi_version) || !KNOWN_EVENT_NAMES.has(ev.name);
    if (bad) {
      const reason = !KNOWN_ABI_VERSIONS.has(ev.abi_version)
        ? `unknown abi_version ${ev.abi_version}`
        : `unknown event name ${ev.name}`;
      await db.collection('chain_events').updateOne(
        { _id: ev._id }, { $set: { dead_letter: true, dead_letter_reason: reason } },
      );
      alerts.push({ event_key: keyOf(ev), reason });
      await db.collection('indexer_alerts').insertOne({
        level: 'warn', type: 'dead_letter', event_key: keyOf(ev), reason, at: new Date(),
      });
    }
  }
  return alerts;
}

export function keyOf(ev) {
  return `${ev.chain_id}:${ev.tx_hash}:${ev.log_index}`;
}

/** Ingestion progress bookkeeping: last contiguous projected block per chain. */
export async function getProgress(db, chainId) {
  const doc = await db.collection('indexer_state').findOne({ _id: `progress:${chainId}` });
  return doc?.lastProjectedBlock ?? null;
}

export async function setProgress(db, chainId, blockNumber, session = undefined) {
  await db.collection('indexer_state').updateOne(
    { _id: `progress:${chainId}` },
    { $set: { lastProjectedBlock: blockNumber, at: new Date() } },
    { upsert: true, session },
  );
}
