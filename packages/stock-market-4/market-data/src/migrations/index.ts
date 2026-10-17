import type { Migration } from '@quant-fusion/sqlite-migrations';
import { migration0001Init } from './0001_init.js';
import { migration0003FusionFundamentalV0Seed } from './0003_fusion_fundamental_v0_seed.js';
import { migration0004AppendBars } from './0004_append_bars.js';
import { migration0005AppendBars } from './0005_append_bars.js';
import { migration0006AppendBars } from './0006_append_bars.js';
import { migration0007AppendBars } from './0007_append_bars.js';
import { migration0008AppendBars } from './0008_append_bars.js';
import { migration0009TickerCheckedThroughTable } from './0009_ticker_checked_through_table.js';
import { migration0010AppendBars } from './0010_append_bars.js';
import { migration0011DailyBarsIntradayTable } from './0011_daily_bars_intraday_table.js';
import { migration0012AppendBars } from './0012_append_bars.js';
import { migration0013CheckedThrough } from './0013_checked_through.js';
import { migration0014CheckedThrough } from './0014_checked_through.js';
import { migration0015AppendBars } from './0015_append_bars.js';
import { migration0016CheckedThrough } from './0016_checked_through.js';
import { migration0017PublishDatasetVersion } from './0017_publish_dataset_version.js';
import { migration0018AppendBars } from './0018_append_bars.js';
import { migration0019AppendBars } from './0019_append_bars.js';
import { migration0020AppendBars } from './0020_append_bars.js';
import { migration0021AppendBars } from './0021_append_bars.js';
import { migration0022CheckedThrough } from './0022_checked_through.js';
import { migration0023AppendBars } from './0023_append_bars.js';
import { migration0024AppendBars } from './0024_append_bars.js';
import { migration0026AppendBars } from './0026_append_bars.js';
import { migration0027AppendBars } from './0027_append_bars.js';

/**
 * Every migration this package's SQLite files apply, in the order new ones get appended —
 * `applyMigrations` itself re-sorts by `id`, so this array's order is for readability only.
 *
 * No `0002_*` here deliberately: an earlier attempt to bake `test/fixtures/sampleDataset.ts` (the
 * package's own unit-test fixture) into a migration collided with that same fixture being
 * separately published in every isolated test store (`createMarketDataStore` already applies
 * every migration here, including to a brand-new temp file a test then ALSO calls
 * `publishDatasetVersion` on with the same identity). Only genuinely curated, real content
 * belongs in this list — see `scripts/seedFusionFixture.ts`'s own doc comment for why that
 * script stays a direct-write dev convenience instead.
 */
export const marketDataMigrations: Migration[] = [
  migration0001Init,
  migration0003FusionFundamentalV0Seed,
  migration0004AppendBars,
  migration0005AppendBars,
  migration0006AppendBars,
  migration0007AppendBars,
  migration0008AppendBars,
  migration0009TickerCheckedThroughTable,
  migration0010AppendBars,
  migration0011DailyBarsIntradayTable,
  migration0012AppendBars,
  migration0013CheckedThrough,
  migration0014CheckedThrough,
  migration0015AppendBars,
  migration0016CheckedThrough,
  migration0017PublishDatasetVersion,
  migration0018AppendBars,
  migration0019AppendBars,
  migration0020AppendBars,
  migration0021AppendBars,
  migration0022CheckedThrough,
  migration0023AppendBars,
  migration0024AppendBars,
  migration0026AppendBars,
  migration0027AppendBars,
];
