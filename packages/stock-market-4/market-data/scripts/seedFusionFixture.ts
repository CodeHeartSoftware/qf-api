/**
 * One-time local seed script: writes the package's own synthetic proof dataset directly into the
 * shared Stock Market 4 database (`.quant-fusion/db.sqlite` — see
 * `docs/adr/0014-sqlite-standard-and-migrations.md`). Run via
 * `yarn workspace @quant-fusion/market-data run seed:fusion-fixture`.
 *
 * Deliberately NOT a migration-generator (unlike `seedFusionFundamentalV0.ts`/
 * `appendBarsFromFile.ts`/`fetchAndAppendBars.ts`): `test/fixtures/sampleDataset.ts` is this
 * package's own unit-test fixture, already published independently inside every isolated test
 * store by the test suite itself — baking it into a migration would mean EVERY market-data store
 * (including a brand-new test's own temp file) gets it stamped in automatically, colliding with
 * that same test then publishing the identical `(id, version)` itself. Only genuinely curated,
 * real content (like `seedFusionFundamentalV0.ts`'s real bot backtest prices) belongs in a
 * migration; this stays a plain local dev/demo convenience.
 *
 * Despite the script's filename (kept for continuity with the Phase 1 design notes), this seeds
 * the generic sample dataset, not fusion-specific data — rename once a real fusion dataset is
 * actually wired up.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createMarketDataStore } from '../src/store/db.js';
import { publishDatasetVersion } from '../src/store/ingest.js';
import {
  SAMPLE_DATASET_ID,
  SAMPLE_DATASET_INPUT,
  SAMPLE_DATASET_VERSION,
} from '../test/fixtures/sampleDataset.js';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_DB_PATH = resolve(
  fileURLToPath(new URL('../../../..', import.meta.url)),
  '.quant-fusion/db.sqlite',
);

const dbPath = DEFAULT_DB_PATH;

mkdirSync(dirname(dbPath), { recursive: true });
const store = createMarketDataStore(dbPath);
const result = publishDatasetVersion(
  store,
  { id: SAMPLE_DATASET_ID, version: SAMPLE_DATASET_VERSION },
  SAMPLE_DATASET_INPUT,
);

if (!result.ok) {
  console.error(result.reason);
  process.exitCode = 1;
} else {
  console.log(
    `seeded ${dbPath} with dataset "${SAMPLE_DATASET_ID}" version "${SAMPLE_DATASET_VERSION}"`,
  );
}
