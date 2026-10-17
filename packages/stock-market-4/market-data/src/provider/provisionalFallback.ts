import type { MarketDataProvider } from './provider.js';

/**
 * Wraps a `MarketDataProvider` so `latestKnownDate`/`barsAsOf` transparently include each
 * ticker's current PROVISIONAL bar (today's price while its exchange's regular session is still
 * open) as if it were a normal, final bar — everything ELSE (`tradingHolidays`,
 * `corporateActionsAsOf`, `tickers`, `checkedThroughDate`) passes straight through unwrapped.
 *
 * Deliberately a decorator over the plain provider interface, not a flag threaded through
 * `forwardShadowCutoffDateFor`/`securitiesAsOf`/every other consumer individually — this way
 * `games/stock-market-4`'s round-advancement/calendar/valuation logic needs ZERO changes and no
 * new "is this provisional?" branch anywhere: it just sees a `MarketDataProvider` that happens to
 * already know about today. The one and only place this wrapper is ever applied is
 * `match forward preview` (via `resumeForwardState`'s own `allowProvisional` option) — `match
 * forward run` NEVER applies it, which is what actually enforces "a round can only be marked
 * complete once the trading day has ended": the real, persisted provider a resumed-for-real match
 * uses is always the plain, unwrapped one, so a provisional bar can never influence
 * `forwardShadowCutoffDate`/`roundsPlayed` for real, only a transient preview read.
 */
export function withProvisionalFallback(provider: MarketDataProvider): MarketDataProvider {
  return {
    ...provider,
    latestKnownDate: (ticker) => {
      const real = provider.latestKnownDate(ticker);
      const provisional = provider.provisionalBar(ticker);
      if (provisional === null) return real;
      return real === null || provisional.date > real ? provisional.date : real;
    },
    barsAsOf: (ticker, asOfDate, maxDays) => {
      const real = provider.barsAsOf(ticker, asOfDate, maxDays);
      const provisional = provider.provisionalBar(ticker);
      // Irrelevant here: no provisional bar at all, it's dated after what the caller asked for
      // (`asOfDate` predates it), or a real bar for that exact date already exists (shouldn't
      // normally happen — the ingestion side clears a provisional row once the real one lands —
      // but stay safe and prefer the real bar rather than ever shadowing it).
      if (
        provisional === null ||
        provisional.date > asOfDate ||
        real.some((bar) => bar.date === provisional.date)
      ) {
        return real;
      }
      const merged = [...real, provisional];
      return Number.isFinite(maxDays) ? merged.slice(-maxDays) : merged;
    },
  };
}
