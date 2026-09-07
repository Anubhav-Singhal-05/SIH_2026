# SIH-26 — Database & Merkle Team

MongoDB Atlas schema/migrations, a reorg-aware blockchain event indexer, the
Merkle snapshot/proof service, typed repositories, reconciliation, storage
lifecycle, and backup/recovery tooling. The Merkle algorithm lives in
`packages/protocol` — the sole legal implementation, with frozen golden
vectors.

**Data authority rule:** the database is a rebuildable read model. The chain
(`AssetRegistry`, `AssetAccessRegistry`, `MerkleRootRegistry`) is always the
ownership/permission/root authority. Projections stay provisional until the
confirmation depth is reached, and a reorg flags stale history as
non-canonical instead of deleting it.

> Full file-by-file documentation: [`Functionality.md`](Functionality.md) ·
> Data model: [`schema.md`](schema.md)

---

## 1. Prerequisites

- Node.js 22+ and npm
- Python 3.12+ (only for the dummy-data population script)
- A MongoDB Atlas cluster (the free M0 tier works)

## 2. Setup

```bash
git clone <repo> && cd SIH-26

# Node workspace dependencies
npm install

# Python venv for the dummy-data script (never global site-packages)
python -m venv venv
venv\Scripts\activate        # Windows
source venv/bin/activate     # macOS/Linux
pip install -r requirements.txt
```

## 3. Credentials

Copy a template and fill in **your own** Atlas values — the real file is
git-ignored and never committed:

```bash
copy atlas-credentials.env.example atlas-credentials.env   # Windows
cp atlas-credentials.env.example atlas-credentials.env     # macOS/Linux
```

Standard variable names, shared by the Node and Python layers (shell
environment variables win over the file; see `.env.example` too):

```ini
MONGODB_URI="mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net"
MONGODB_DB_NAME="sih26_dev"
MONGODB_USERNAME="<user>"
MONGODB_PASSWORD="<password>"
```

## 4. Apply the schema (migrations)

Migrations are **forward-only**; they create every collection with its strict
`$jsonSchema` validator and all indexes (22 spec collections + 3 indexer
infrastructure collections):

```bash
npm run migrate           # apply all pending migrations
npm run migrate:status    # list applied/pending migrations
```

## 5. Populate with dummy data (dev only)

```bash
venv\Scripts\activate                                  # if not already active
python database/scripts/populate_dummy_data.py --identities 20 --assets 50 --seed 42 --reset
```

- Fills all 26 collections with schema-valid **dummy/dev data** (synthetic
  values only — no real users or chain data).
- `--reset` drops the data collections first (migration history in
  `schema_migrations` is preserved). Without it, the script refuses to run
  against a database that already has data.
- Verify the result: `python database/scripts/verify_dummy_data.py`

## 6. Run the workers

```bash
npm run indexer       # one indexing pass: raw ledger -> projections -> finalization -> outbox
npm run reconciler    # recompute all root snapshots + scan for P1 atomicity violations
npm run lifecycle     # storage inventory GC sweep (staged/orphaned cleanup, legal holds)
```

The indexer reads its start block, ABI version and confirmation depth from
`config/deployment-manifest.json`. In production, wire real chain providers
into `apps/api/src/run.js` (the default placeholder is an in-memory provider
that safely does nothing against a real chain).

## 7. Run the tests

```bash
npm test              # all three workspaces
```

- `packages/protocol` — pure golden-vector tests (no database needed)
- `database` + `apps/api` — integration tests that create **ephemeral** Atlas
  databases (unique name per run, dropped afterwards); nothing is ever written
  to the dev database by the test suite. Tests are serialized
  (`--test-concurrency=1`) to stay gentle on Atlas free-tier connections.
- Every test maps 1:1 to a checklist ID in `03_database_test_cases.md`
  (`DB-SCHEMA-*`, `DB-INDEX-*`, `DB-MERKLE-*`, `DB-STORAGE-*`, `DB-BACKUP-*`,
  `DB-ACCEPT-*`).

## 8. Operations notes

- **Least-privilege roles**: `database/roles/roles.js` defines `sih26App`,
  `sih26ReadOnly`, `sih26Migrator`, `sih26BreakGlass`; run
  `node database/roles/roles.js` to print the `createRole`/`createUser`
  commands for the ops runbook.
- **Migrations are forward-only.** Never edit an applied migration; add a new
  numbered file with `up()`, a description, the index impact, and a documented
  rollback-safe deployment procedure.
- **Backup/restore**: the restore pipeline
  (`apps/api/src/workers/backup/replay.js`) is isolated restore → migrate →
  replay finalized logs → regenerate snapshots → compare roots → promote only
  after a passing comparison **and** signed approval.
- **Reorg safety**: orphaned blocks/events are flagged non-canonical and kept
  forever (forensic audit); provisional projections are delete-and-replay;
  finalized stale rows are flagged, never overwritten in place.
- **Monitoring hooks**: alerts land in `indexer_alerts` (dead-letter,
  root-mismatch, P1 atomicity, quarantine) and outbox rows in `event_outbox`.
