// Indexer orchestrator: one safe pass from the manifest deployment block to
// the provider head — raw idempotent storage, dead-letter gate, reorg check,
// strict-order projection, finalization, post-commit outbox publish.

import { FailoverProvider } from '../chain/provider.js';
import { loadManifest } from '../chain/manifest.js';
import { storeRawLogs, deadLetterUnknown } from './ingest.js';
import { projectEvents, publishOutbox } from './project.js';
import { finalizeUpTo } from './finalize.js';
import { detectReorg, handleReorg } from './reorg.js';

/**
 * @param {import('mongodb').Db} db
 * @param {import('mongodb').MongoClient} client
 * @param {import('../chain/provider.js').ChainProvider[]} providers
 * @param {{manifest?: object, maxRangeSize?: number}} opts
 */
export async function runOnce(db, client, providers, { manifest, maxRangeSize } = {}) {
  const m = manifest ?? loadManifest();
  const provider = providers instanceof FailoverProvider ? providers : new FailoverProvider(providers, { maxRangeSize });
  const result = { from: m.deploymentBlock, ingested: 0, projected: 0, finalized: 0, reorg: null, deadLetters: 0 };

  const head = await provider.latestBlock();
  if (head < m.deploymentBlock) return result; // chain not yet at deployment block

  // 1. ingest raw logs from the deployment block (or resume point) with bounded ranges
  const state = await db.collection('indexer_state').findOne({ _id: `progress:${m.chainId}` });
  const lastIngested = state?.lastIngestedBlock ?? m.deploymentBlock - 1;
  if (head > lastIngested) {
    const logs = await provider.getLogs(lastIngested + 1, head);
    // 2. reorg check before touching projections
    if (logs.length) {
      const first = logs[0];
      const ancestor = await detectReorg(db, m.chainId, { blockNumber: first.blockNumber, parentHash: first.parentHash });
      if (ancestor !== null) {
        const replacement = await provider.getLogs(ancestor + 1, head);
        result.reorg = await handleReorg(db, client, m.chainId, ancestor, replacement);
      }
      const { blocks, events } = await storeRawLogs(db, logs);
      result.ingested += blocks + events;
      await db.collection('indexer_state').updateOne(
        { _id: `progress:${m.chainId}` },
        { $set: { lastIngestedBlock: head } },
        { upsert: true },
      );
      result.deadLetters += (await deadLetterUnknown(db)).length;
    }
  }

  // 3. project in strict order, one tx per block
  result.projected += (await projectEvents(db, client, head, { outbox: true })).length;

  // 4. finalization at confirmation depth
  result.finalized += await finalizeUpTo(db, head, m.confirmationDepth);

  // 5. publish committed outbox notifications (post-commit only)
  result.outboxPublished = await publishOutbox(db);
  return result;
}
