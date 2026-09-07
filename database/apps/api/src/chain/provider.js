// Chain provider abstraction + bounded-range fetching with provider failover
// (DB-INDEX-002). A provider supplies logs/blocks for a specific ABI version.

/**
 * @typedef {Object} ChainProvider
 * @property {string} name
 * @property {(fromBlock:number, toBlock:number) => Promise<Array<{blockNumber:number, blockHash:string, parentHash:string, timestamp:number, txHash:string, txIndex:number, logIndex:number, contract:string, name:string, payload:object}>>} getLogs
 * @property {(blockNumber:number) => Promise<{number:number, hash:string, parentHash:string, timestamp:number}>} getBlock
 * @property {() => Promise<number>} latestBlock
 */

/**
 * Failover chain provider: tries providers in order; bounded range size.
 */
export class FailoverProvider {
  /**
   * @param {ChainProvider[]} providers
   * @param {{maxRangeSize?: number, onFailover?: (from:string,to:string,fromBlock:number,toBlock:number)=>void}} opts
   */
  constructor(providers, { maxRangeSize = 2000, onFailover } = {}) {
    if (!providers.length) throw new Error('FailoverProvider requires at least one provider');
    this.providers = providers;
    this.maxRangeSize = maxRangeSize;
    this.onFailover = onFailover;
    this.activeIndex = 0;
  }

  /** Fetch logs for [fromBlock, toBlock] in bounded sub-ranges with failover. */
  async getLogs(fromBlock, toBlock) {
    if (toBlock < fromBlock) throw new RangeError('toBlock < fromBlock');
    const logs = [];
    for (let start = fromBlock; start <= toBlock; start += this.maxRangeSize) {
      const end = Math.min(start + this.maxRangeSize - 1, toBlock);
      logs.push(...(await this.fetchRange(start, end)));
    }
    return logs;
  }

  async fetchRange(start, end) {
    let lastErr;
    for (let i = 0; i < this.providers.length; i++) {
      const p = this.providers[(this.activeIndex + i) % this.providers.length];
      try {
        const logs = await p.getLogs(start, end);
        this.activeIndex = (this.activeIndex + i) % this.providers.length;
        return logs;
      } catch (err) {
        lastErr = err;
        this.onFailover?.(p.name, this.providers[(this.activeIndex + i + 1) % this.providers.length].name, start, end);
      }
    }
    throw lastErr;
  }

  async getBlock(blockNumber) {
    let lastErr;
    for (const p of this.providers) {
      try { return await p.getBlock(blockNumber); } catch (err) { lastErr = err; }
    }
    throw lastErr;
  }

  async latestBlock() {
    let lastErr;
    for (const p of this.providers) {
      try { return await p.latestBlock(); } catch (err) { lastErr = err; }
    }
    throw lastErr;
  }
}

/** In-memory provider used by tests (deterministic fake chain). */
export class InMemoryProvider {
  constructor({ name = 'memory', blocks = {}, logs = [], latest = 0 }) {
    this.name = name;
    this.blocks = blocks; // number -> {hash, parentHash, timestamp}
    this.logs = logs; // raw log objects
    this.latest = latest;
  }
  async getLogs(from, to) {
    return this.logs.filter((l) => l.blockNumber >= from && l.blockNumber <= to);
  }
  async getBlock(n) {
    const b = this.blocks[n];
    if (!b) throw new Error(`block ${n} not found on provider ${this.name}`);
    return { number: n, ...b };
  }
  async latestBlock() { return this.latest; }
}
