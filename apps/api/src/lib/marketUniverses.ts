import { TRACKED_SECURITIES } from '@quant-fusion/fusion-universe';

export interface MarketUniverse {
  /** URL-facing slug — e.g. `fusion`. */
  id: string;
  /** Which game trades this universe — informational today (only `stock-market-4` exists), but
   * kept explicit rather than assumed so a second game's universe is a registry entry away, not
   * a refactor. */
  game: string;
  label: string;
  /** The `@quant-fusion/market-data` dataset identity this universe's prices live under. */
  datasetId: string;
  /** Pinned, not auto-detected — `@quant-fusion/market-data` datasets are deliberately immutable
   * per version (see that package's `dataset/identity.ts`); a new version is a rare, deliberate
   * re-seed a person decides on, the same reason `emitForwardMatchConfig.ts` requires this as an
   * explicit `--market-dataset-version` rather than discovering "the latest" on its own. */
  datasetVersion: string;
  tickers: readonly string[];
}

/**
 * Every market universe this app can fetch fresh prices for — explicit and hand-maintained,
 * unlike the freshness display (`computeMarketDataStatus`'s own `discoverActiveMarketDatasets`),
 * which deliberately derives "what's tracked" from whichever forward matches happen to be active
 * right now. Those are different questions: "what's currently being traded" (freshness) vs.
 * "which universes exist and can be addressed directly" (this registry, and the Jobs tab's own
 * per-universe fetch action) — a universe here is fetchable independent of whether any match is
 * currently active against it.
 *
 * One real entry today — the fusion portfolio — but the shape (id/game/label/dataset identity/
 * tickers) is what a second game's universe would need too, so adding one later is a registry
 * entry, not a redesign.
 */
export const MARKET_UNIVERSES: MarketUniverse[] = [
  {
    id: 'fusion',
    game: 'stock-market-4',
    label: 'Fusion Portfolio',
    datasetId: 'fusion-fundamental-v0',
    // v4 (2026-09-22): Yahoo Finance bars from 2026-01-02 (market-data migration
    // 0017_publish_dataset_version, built by `fetch:publish-version`) — v3 only began 2026-06-30.
    // Matches already pinned to v3 keep reading v3; only new matches and this universe's own fetch
    // job use v4.
    datasetVersion: '4',
    tickers: TRACKED_SECURITIES.map((security) => security.ticker),
  },
];

export function findMarketUniverse(id: string): MarketUniverse | undefined {
  return MARKET_UNIVERSES.find((universe) => universe.id === id);
}

/** The job-run-store `jobId` this universe's fetch action records/lists history under —
 * computed in one place so the route, the UI, and any future consumer never risk drifting on the
 * naming convention (`market-data-fetch:<universeId>`). */
export function marketDataFetchJobId(universeId: string): string {
  return `market-data-fetch:${universeId}`;
}
