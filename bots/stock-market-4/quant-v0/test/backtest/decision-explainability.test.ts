import { describe, expect, it } from 'vitest';
import { runBacktest } from '../../backtest/runBacktest.js';
import { FULL_PRICE_SERIES_BY_TICKER } from '../../backtest/walkForward.js';
import { DEFAULT_FUSION_QUANT_CONFIG } from '../../src/config.js';

/** The fields `quant-fusion-ui`'s `DecisionExplainer` renders to explain WHY a name was or
 * wasn't held (rank vs. top-k) and what its fair value was anchored to — checked against a real
 * backtest rather than hand-built fixtures, since they're only meaningful across a whole round. */
describe('decision explainability fields', () => {
  const { decisions } = runBacktest();
  const selection = DEFAULT_FUSION_QUANT_CONFIG.portfolioConstruction.selection;
  const byDate = new Map<string, typeof decisions>();
  for (const d of decisions) byDate.set(d.date ?? '', [...(byDate.get(d.date ?? '') ?? []), d]);

  it('ranks every priced security 1..N each round, and selects exactly the top-k positive scores', () => {
    expect(selection?.mode).toBe('top_k');
    const k = selection?.mode === 'top_k' ? selection.k : 0;
    for (const round of byDate.values()) {
      const ranks = round.map((d) => d.selection.rank).sort((a, b) => a - b);
      expect(ranks).toEqual(round.map((_, i) => i + 1));
      for (const d of round) {
        expect(d.selection.rankedOf).toBe(round.length);
        expect(d.selection.selected).toBe(d.selection.rank <= k && d.selection.score > 0);
        if (!d.selection.selected) expect(d.desiredWeight).toBe(0);
      }
    }
  });

  it("reports the point-in-time anchor as the first close the bot saw for that ticker", () => {
    for (const d of decisions) {
      expect(d.baseAnchor.mode).toBe('first_observed');
      expect(d.baseAnchor.basePerShare).toBe(FULL_PRICE_SERIES_BY_TICKER[d.security]![0]!.close);
    }
  });
});
