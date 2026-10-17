import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  printForwardStandings,
  printPortfolioSummaries,
  printSecurityPriceTable,
  printStockPriceRange,
} from '../src/commands/match.js';

describe('printStockPriceRange', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints the range for a result carrying startingStockPrice/finalStockPrice (Stock Market)', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    printStockPriceRange({ startingStockPrice: 135.76, finalStockPrice: 140.21 });
    expect(log).toHaveBeenCalledWith('  (stock price: $135.76 → $140.21)');
  });

  it('prints the range for a result carrying startingPrice/finalPrice (Stock Market 2)', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    printStockPriceRange({ startingPrice: 100, finalPrice: 99.27 });
    expect(log).toHaveBeenCalledWith('  (stock price: $100.00 → $99.27)');
  });

  it('prefers startingStockPrice/finalStockPrice when a result somehow carries both pairs', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    printStockPriceRange({
      startingStockPrice: 1,
      finalStockPrice: 2,
      startingPrice: 3,
      finalPrice: 4,
    });
    expect(log).toHaveBeenCalledWith('  (stock price: $1.00 → $2.00)');
  });

  it('is a no-op for a result with neither pair of fields', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    printStockPriceRange({ winnerId: 'alice' });
    expect(log).not.toHaveBeenCalled();
  });

  it('is a no-op for non-object results', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    printStockPriceRange(null);
    printStockPriceRange(undefined);
    printStockPriceRange('not an object');
    expect(log).not.toHaveBeenCalled();
  });
});

describe('printSecurityPriceTable', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints a before -> after line per security (Stock Market 3)', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    printSecurityPriceTable({
      securityPrices: [
        { symbol: 'ACME', startingPrice: 100, finalPrice: 140.21 },
        { symbol: 'BETA', startingPrice: 50, finalPrice: 12.5 },
      ],
    });
    expect(log).toHaveBeenCalledWith('  Security prices (before -> after):');
    expect(log).toHaveBeenCalledWith('    ACME: $100.00 -> $140.21 (+40.2%)');
    expect(log).toHaveBeenCalledWith('    BETA: $50.00 -> $12.50 (-75.0%)');
  });

  it('is a no-op for a result with no securityPrices field', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    printSecurityPriceTable({ winnerId: 'alice' });
    expect(log).not.toHaveBeenCalled();
  });

  it('is a no-op for non-object results', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    printSecurityPriceTable(null);
    printSecurityPriceTable('not an object');
    expect(log).not.toHaveBeenCalled();
  });
});

describe('printPortfolioSummaries', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints cash/equity and each open position per participant (Stock Market 3)', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    printPortfolioSummaries({
      portfolioSummaries: {
        alice: {
          cash: 5000,
          equity: 10500.5,
          bankrupt: false,
          positions: [
            {
              symbol: 'ACME',
              shares: 100,
              averageEntryPrice: 90,
              marketValue: 14021,
              unrealizedPnl: 5021,
            },
          ],
        },
        bob: { cash: 0, equity: 0, bankrupt: true, positions: [] },
      },
    });
    expect(log).toHaveBeenCalledWith('  Bot portfolios:');
    expect(log).toHaveBeenCalledWith('    alice: equity $10500.50, cash $5000.00');
    expect(log).toHaveBeenCalledWith(
      '      ACME: 100 sh @ avg $90.00, value $14021.00 (+$5021.00 unrealized)',
    );
    expect(log).toHaveBeenCalledWith('    bob: equity $0.00, cash $0.00 [BANKRUPT]');
    expect(log).toHaveBeenCalledWith('      (no open positions)');
  });

  it('is a no-op for a result with no portfolioSummaries field', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    printPortfolioSummaries({ winnerId: 'alice' });
    expect(log).not.toHaveBeenCalled();
  });

  it('is a no-op for non-object results', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    printPortfolioSummaries(null);
    printPortfolioSummaries('not an object');
    expect(log).not.toHaveBeenCalled();
  });
});

describe('printForwardStandings', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function sampleSummary(aliceLastFills: unknown[] = []) {
    return {
      asOfDate: '2026-08-31',
      benchmarkReturn: -0.1475,
      standings: [
        {
          participantId: 'alice',
          rank: 1,
          equityCents: 11979401,
          cashCents: 500000,
          totalReturn: 0.1979,
          maxDrawdown: 0.2287,
          annualizedVolatility: 0.5795,
          sharpeRatio: 2.07,
          positions: [
            { ticker: 'ELMT', shares: 100, marketValueCents: 173200, unrealizedPnlCents: 5000 },
          ],
          lastFills: aliceLastFills,
        },
        {
          participantId: 'bob',
          rank: 2,
          equityCents: 10000000,
          cashCents: 10000000,
          totalReturn: 0,
          maxDrawdown: 0,
          annualizedVolatility: 0,
          sharpeRatio: null,
          positions: [],
          lastFills: [],
        },
      ],
    };
  }

  it('prints ranked standings with portfolio stats, positions, and a benchmark comparison', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    printForwardStandings(sampleSummary(), ['alice', 'bob']);

    expect(log).toHaveBeenCalledWith('\nStandings as of 2026-08-31:');
    expect(log).toHaveBeenCalledWith(
      '  1. alice: equity $119794.01, cash $5000.00, return 19.79%, max drawdown 22.87%, volatility 57.95%, Sharpe 2.07',
    );
    expect(log).toHaveBeenCalledWith('       ELMT: 100 sh, value $1732.00 (+$50.00 unrealized)');
    expect(log).toHaveBeenCalledWith(
      '  2. bob: equity $100000.00, cash $100000.00, return 0.00%, max drawdown 0.00%, volatility 0.00%, Sharpe n/a',
    );
    expect(log).toHaveBeenCalledWith('  (benchmark buy-and-hold return so far: -14.75%)');
  });

  it('summarizes each bot\'s most recent fills under a "what each bot did" section', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    printForwardStandings(
      sampleSummary([
        {
          ticker: 'ELMT',
          side: 'BUY',
          kind: 'MARKET',
          requestedQuantity: 100,
          filledQuantity: 100,
          priceCents: 1732,
          feeCents: 17,
        },
      ]),
      ['alice', 'bob'],
    );

    expect(log).toHaveBeenCalledWith('\nWhat each bot did on 2026-08-31:');
    expect(log).toHaveBeenCalledWith('  alice:');
    expect(log).toHaveBeenCalledWith('    BUY 100 ELMT @ $17.32, fee $0.17');
    expect(log).toHaveBeenCalledWith('  bob: held (no trades)');
  });

  it('reports a requested-but-unfilled order distinctly from "held"', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    printForwardStandings(
      sampleSummary([
        {
          ticker: 'ELMT',
          side: 'BUY',
          kind: 'LIMIT',
          requestedQuantity: 50,
          filledQuantity: 0,
          priceCents: 1000,
          feeCents: 0,
        },
      ]),
      ['alice'],
    );
    expect(log).toHaveBeenCalledWith('    BUY ELMT: requested 50, filled 0 (no fill)');
  });

  it('is a no-op when standings is missing/empty, or the summary is not object-shaped', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    printForwardStandings({ asOfDate: '2026-08-31', standings: [] }, ['alice']);
    printForwardStandings({ winnerId: 'alice' }, ['alice']);
    printForwardStandings(null, ['alice']);
    expect(log).not.toHaveBeenCalled();
  });
});
