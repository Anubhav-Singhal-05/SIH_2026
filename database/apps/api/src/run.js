// Worker entry: `npm start -w apps/api -- indexer|reconciler|lifecycle`
import { connect, getDb, disconnect } from '@sih/database/db';
import { runOnce } from './indexer/index.js';
import { verifyAllSnapshots, scanAtomicityViolations } from './workers/reconciler/index.js';
import { StorageLifecycleService } from './workers/lifecycle/index.js';
import { InMemoryProvider } from './chain/provider.js';

const command = process.argv[2] ?? 'indexer';

const client = await connect();
const db = await getDb();

switch (command) {
  case 'indexer': {
    // Production wires real providers here; the InMemoryProvider placeholder
    // makes a misconfiguration loud instead of silently indexing nothing.
    const result = await runOnce(db, client, [new InMemoryProvider({})]);
    console.log(JSON.stringify(result));
    break;
  }
  case 'reconciler': {
    const snapshots = await verifyAllSnapshots(db);
    const violations = await scanAtomicityViolations(db);
    console.log(JSON.stringify({ snapshots, violations }));
    break;
  }
  case 'lifecycle': {
    const svc = new StorageLifecycleService(db);
    console.log(JSON.stringify(await svc.collectGarbage()));
    break;
  }
  default:
    console.error(`unknown command ${command}`);
    process.exitCode = 1;
}

await disconnect();
