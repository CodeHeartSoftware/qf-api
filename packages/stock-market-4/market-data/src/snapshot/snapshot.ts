import { z } from 'zod';
import { CorporateActionSchema } from '../schema/corporateAction.js';
import { CalendarDateSchema, DailyBarSchema, type CalendarDate } from '../schema/dailyBar.js';
import type { MarketDataProvider } from '../provider/provider.js';

/**
 * A self-contained, serializable, immutable-from-the-consumer's-perspective view of one dataset
 * as of one date — the same "dataset identity + reconstructed state" shape as
 * `@quant-fusion/research-core`'s own `ResearchSnapshot`, for the same reason: it's a convenient
 * unit to log, diff, or hand to offline tooling without holding a live provider/store handle.
 *
 * This is NOT part of any game's bot-facing wire protocol — `games/stock-market-4`'s own
 * `getObservation` builds its `SecurityMarketObservation`s directly from a `MarketDataProvider`
 * (split-adjusted, per-participant), which this snapshot deliberately does not attempt to
 * duplicate. Use this for exploration, debugging, or a maintainer-facing audit record, not for
 * anything a bot receives.
 */
export const MarketSnapshotSchema = z
  .object({
    datasetId: z.string().min(1),
    datasetVersion: z.string().min(1),
    asOfDate: CalendarDateSchema,
    securities: z.array(
      z
        .object({
          ticker: z.string().min(1),
          bar: DailyBarSchema.nullable(),
          history: z.array(DailyBarSchema),
        })
        .strict(),
    ),
    corporateActions: z.array(CorporateActionSchema),
  })
  .strict();
export type MarketSnapshot = z.infer<typeof MarketSnapshotSchema>;

/** Builds a `MarketSnapshot` from a live `provider` — unadjusted bars exactly as stored (no
 * split-adjustment: that's a game-specific concern, see this file's own doc comment above). */
export function createMarketSnapshot(
  provider: MarketDataProvider,
  tickers: readonly string[],
  asOfDate: CalendarDate,
  maxDays: number,
): MarketSnapshot {
  const securities = tickers.map((ticker) => {
    const history = provider.barsAsOf(ticker, asOfDate, maxDays);
    const latest = history.at(-1);
    return { ticker, bar: latest?.date === asOfDate ? latest : null, history };
  });
  return {
    datasetId: provider.identity.id,
    datasetVersion: provider.identity.version,
    asOfDate,
    securities,
    corporateActions: provider.corporateActionsAsOf(null, asOfDate),
  };
}
