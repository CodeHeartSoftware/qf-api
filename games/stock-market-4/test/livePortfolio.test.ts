import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMarketDataStore, publishDatasetVersion } from '@quant-fusion/market-data';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { observeLivePortfolio, stockMarket4 } from '../src/game.js';

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sm4-live-portfolio-'));
  dbPath = join(dir, 'md.sqlite');
  const bar = (date: string, close: number) => ({
    date,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1000,
  });
  const published = publishDatasetVersion(
    createMarketDataStore(dbPath),
    { id: 'ds', version: '1' },
    {
      bars: {
        AAA: [bar('2026-01-05', 10), bar('2026-01-06', 11), bar('2026-01-07', 12)],
        BBB: [bar('2026-01-05', 20), bar('2026-01-06', 21), bar('2026-01-07', 22)],
      },
    },
  );
  if (!published.ok) throw new Error(published.reason);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function config() {
  const parsed = stockMarket4.parseConfig({
    startDate: '2026-01-05',
    endDate: '2026-12-31',
    marketDataUniverse: ['AAA', 'BBB'],
    gameType: 'FORWARD_SHADOW',
    marketDataset: { id: 'ds', version: '1', dbPath },
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.value;
}

describe('observeLivePortfolio', () => {
  it("observes the real portfolio on the dataset's latest trading day", () => {
    const { observation, date } = observeLivePortfolio({
      config: config(),
      participantId: 'bot',
      portfolio: {
        cashCents: 50_000,
        positions: [
          { ticker: 'AAA', shares: 100, averageEntryPriceCents: 1000 },
          { ticker: 'ZZZ', shares: 5, averageEntryPriceCents: 100 }, // outside the universe — ignored
        ],
      },
    });
    expect(date).toBe('2026-01-07');
    expect(observation.date).toBe('2026-01-07');
    expect(observation.portfolio.cashCents).toBe(50_000);
    expect(observation.portfolio.positions).toEqual([
      expect.objectContaining({ ticker: 'AAA', shares: 100, marketValueCents: 120_000 }),
    ]);
    expect(observation.portfolio.equityCents).toBe(170_000);
    expect(observation.securities.find((s) => s.ticker === 'AAA')?.history).toHaveLength(3);
  });

  it('refuses a non-FORWARD_SHADOW config', () => {
    expect(() =>
      observeLivePortfolio({
        config: { ...config(), gameType: 'HISTORICAL' },
        participantId: 'bot',
        portfolio: { cashCents: 0, positions: [] },
      }),
    ).toThrow(/FORWARD_SHADOW/);
  });
});
