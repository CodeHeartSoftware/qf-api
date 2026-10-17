import type { CorporateAction } from '../schema/corporateAction.js';
import type { CalendarDate, DailyBar } from '../schema/dailyBar.js';
import type { MarketDatasetIdentity } from '../dataset/identity.js';
import { err, ok, type Result } from '../result.js';
import type { MarketDataStore } from '../store/db.js';
import {
  datasetVersionExists,
  queryBarsAsOf,
  queryCheckedThroughDate,
  queryCorporateActionsAsOf,
  queryLatestKnownDate,
  queryTickers,
  queryTradingHolidays,
} from '../store/queries.js';
import { queryProvisionalBar } from '../store/provisional.js';

/**
 * The ONLY interface a consumer (a game engine) should ever hold — never the raw `MarketDataStore`
 * / `DatabaseSync`. Every method takes an explicit `asOfDate` and never returns a row dated after
 * it, mirroring `games/stock-market-4`'s own "as-of" idiom (`historicalBarsAsOf`,
 * `splitAdjustedBarsAsOf`, `visibleCorporateActions`) so this is a drop-in data source for those
 * existing, unchanged functions rather than a second, parallel implementation of point-in-time
 * filtering.
 */
export interface MarketDataProvider {
  readonly identity: MarketDatasetIdentity;
  /** Every ticker this dataset version has at least one bar for. */
  tickers(): string[];
  /** Every bar for `ticker` at or before `asOfDate`, oldest first, capped to the trailing
   * `maxDays`. */
  barsAsOf(ticker: string, asOfDate: CalendarDate, maxDays: number): DailyBar[];
  /** Every corporate action already public as of `asOfDate`, for `ticker` (or every ticker, when
   * `ticker` is `null`). */
  corporateActionsAsOf(ticker: string | null, asOfDate: CalendarDate): CorporateAction[];
  /** Every organizer-declared non-trading date for this dataset version. */
  tradingHolidays(): CalendarDate[];
  /** The most recent date `ticker` has a published bar for, or `null` if it has none at all — the
   * building block a forward/current-day consumer combines across whatever tickers it cares about
   * to know how far real data currently extends. This provider makes no assumption about which
   * tickers matter to any particular match/policy; see `games/stock-market-4`'s
   * `forwardShadowCutoffDateFor` for one such policy (a `MIN` across a traded universe). */
  latestKnownDate(ticker: string): CalendarDate | null;
  /** The latest date `ticker` has been POSITIVELY CONFIRMED to have no bar for (a real ingestion
   * check ran and found nothing), or `null` if never checked. Distinct from `latestKnownDate`:
   * this can be LATER than it (e.g. a confirmed market holiday with no bar, but we've verified
   * there's genuinely nothing to fetch) while `latestKnownDate` never advances without an actual
   * bar. See `games/stock-market-4`'s `forwardShadowCutoffDateFor` for the policy that combines
   * both — a confirmed gap unblocks the cutoff the same way real data would, an unconfirmed one
   * (ordinary ingestion lag) does not. */
  checkedThroughDate(ticker: string): CalendarDate | null;
  /** `ticker`'s current PROVISIONAL bar — today's price while its exchange's regular session is
   * still open, or `null` if none is recorded (the common case). Never counted by
   * `latestKnownDate`/`checkedThroughDate` and never visible to `games/stock-market-4`'s
   * `forwardShadowCutoffDateFor` — a provisional bar can never advance a match's real,
   * persisted round; it exists purely for a non-mutating preview to read (see `match forward
   * preview`'s own doc comment) so a person can see how bots would trade mid-day without that
   * ever becoming the match's actual outcome for the day. */
  provisionalBar(ticker: string): DailyBar | null;
}

/**
 * Builds a `MarketDataProvider` over an already-open `store`, scoped to one `(id, version)`.
 * Fails closed (`Result`, never throws) when that dataset version was never published — a match
 * config referencing a dataset that doesn't exist should error clearly at setup time, not
 * silently behave as an empty market.
 */
export function createSqliteMarketDataProvider(
  store: MarketDataStore,
  identity: MarketDatasetIdentity,
): Result<MarketDataProvider> {
  if (!datasetVersionExists(store, identity)) {
    return err(`dataset "${identity.id}" has no published version "${identity.version}"`);
  }
  return ok({
    identity,
    tickers: () => queryTickers(store, identity),
    barsAsOf: (ticker, asOfDate, maxDays) =>
      queryBarsAsOf(store, identity, ticker, asOfDate, maxDays),
    corporateActionsAsOf: (ticker, asOfDate) =>
      queryCorporateActionsAsOf(store, identity, ticker, asOfDate),
    tradingHolidays: () => queryTradingHolidays(store, identity),
    latestKnownDate: (ticker) => queryLatestKnownDate(store, identity, ticker),
    checkedThroughDate: (ticker) => queryCheckedThroughDate(store, identity, ticker),
    provisionalBar: (ticker) => queryProvisionalBar(store, identity, ticker),
  });
}
