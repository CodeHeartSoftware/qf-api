import { createMarketDataStore, publishDatasetVersion } from '@quant-fusion/market-data';
import { createRng } from '@quant-fusion/rng';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stockMarket4 } from '../../src/game.js';
import type { StockMarket4Action } from '../../src/types.js';

/**
 * Proves `config.marketDataset` (roadmap Phase 1 — SQLite-backed `@quant-fusion/market-data`) is a
 * genuine drop-in for inline `historicalPrices`/`corporateActions`: two configs, identical in
 * every other respect, one sourcing its market data from a seeded SQLite store and one inline,
 * must produce byte-identical observations/results across a full match. This is the direct parity
 * proof the roadmap calls for — not a separate design, a reuse of the exact same assertions the
 * inline path is already tested against elsewhere in this suite.
 */

const rng = createRng(Buffer.alloc(16, 1));
const PARTICIPANT_IDS = ['alice', 'bob'];
const TICKER = 'NVDA';
const DATASET_ID = 'parity-test-dataset';
const DATASET_VERSION = '1';

function flatBar(date: string, price: number) {
  return { date, open: price, high: price, low: price, close: price, volume: 1000 };
}

const NVDA_BARS = [
  flatBar('2026-01-02', 96),
  flatBar('2026-01-05', 100),
  flatBar('2026-01-06', 101),
  flatBar('2026-01-07', 102),
  flatBar('2026-01-08', 103),
  flatBar('2026-01-09', 104),
];

const NVDA_CORPORATE_ACTIONS = [
  { type: 'CASH_DIVIDEND' as const, ticker: TICKER, date: '2026-01-07', perShare: 0.5 },
];

function noopActions(): Map<string, StockMarket4Action> {
  return new Map(PARTICIPANT_IDS.map((id) => [id, { orders: [] }]));
}

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sm4-market-data-parity-'));
  dbPath = join(dir, 'db.sqlite');
  const store = createMarketDataStore(dbPath);
  const published = publishDatasetVersion(
    store,
    { id: DATASET_ID, version: DATASET_VERSION },
    { bars: { [TICKER]: NVDA_BARS }, corporateActions: NVDA_CORPORATE_ACTIONS },
  );
  if (!published.ok) throw new Error(published.reason);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function inlineConfigInput(overrides: Record<string, unknown> = {}) {
  return {
    startDate: '2026-01-05',
    endDate: '2026-01-09',
    marketDataUniverse: [TICKER],
    historicalContextDays: 3,
    historicalPrices: { [TICKER]: NVDA_BARS },
    corporateActions: NVDA_CORPORATE_ACTIONS,
    benchmarkTicker: TICKER,
    ...overrides,
  };
}

function marketDatasetConfigInput(overrides: Record<string, unknown> = {}) {
  return {
    startDate: '2026-01-05',
    endDate: '2026-01-09',
    marketDataUniverse: [TICKER],
    historicalContextDays: 3,
    marketDataset: { id: DATASET_ID, version: DATASET_VERSION, dbPath },
    benchmarkTicker: TICKER,
    ...overrides,
  };
}

/** Runs a full match to completion, submitting one BUY for alice on the first round and nothing
 * else, so fills/portfolio math/dividend settlement are all actually exercised, not just
 * replayed with empty actions. */
function playFullMatch(configInput: Record<string, unknown>) {
  const configResult = stockMarket4.parseConfig(configInput);
  if (!configResult.ok) throw new Error(configResult.reason);
  let state = stockMarket4.initialize({
    config: configResult.value,
    participantIds: PARTICIPANT_IDS,
    rng,
  });

  const observationsByRound: unknown[] = [];
  while (!stockMarket4.isTerminal(state)) {
    observationsByRound.push(
      Object.fromEntries(PARTICIPANT_IDS.map((id) => [id, stockMarket4.getObservation(state, id)])),
    );
    const actions = noopActions();
    if (state.round === 0) {
      actions.set('alice', {
        orders: [{ kind: 'MARKET', ticker: TICKER, side: 'BUY', quantity: 10 }],
      });
    }
    state = stockMarket4.resolve({ state, actions, rng }).nextState;
  }

  return { observationsByRound, result: stockMarket4.getResult(state) };
}

describe('marketDataset vs. inline historicalPrices/corporateActions', () => {
  it('produces identical observations and results across a full match', () => {
    const inline = playFullMatch(inlineConfigInput());
    const viaDataset = playFullMatch(marketDatasetConfigInput());
    expect(viaDataset.observationsByRound).toEqual(inline.observationsByRound);
    expect(viaDataset.result).toEqual(inline.result);
  });

  it('the mode label is uninvolved — marketDataMode alone does not encode data source', () => {
    const inline = playFullMatch(inlineConfigInput({ marketDataMode: 'synthetic' }));
    const viaDataset = playFullMatch(marketDatasetConfigInput({ marketDataMode: 'synthetic' }));
    expect(viaDataset.result.marketDataMode).toBe('synthetic');
    expect(inline.result.marketDataMode).toBe('synthetic');
  });
});

describe('config validation', () => {
  it('rejects a config with neither historicalPrices nor marketDataset', () => {
    const result = stockMarket4.parseConfig(
      inlineConfigInput({ historicalPrices: {}, corporateActions: [] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('either historicalPrices or marketDataset');
  });

  it('rejects a config declaring both marketDataset AND non-empty inline fields', () => {
    const result = stockMarket4.parseConfig(
      marketDatasetConfigInput({ historicalPrices: { [TICKER]: NVDA_BARS } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('mutually exclusive');
  });

  it('allows marketDataset with the inline fields left at their empty defaults', () => {
    expect(stockMarket4.parseConfig(marketDatasetConfigInput()).ok).toBe(true);
  });
});

describe('initialize() dataset resolution', () => {
  it('throws a clear error when marketDataUniverse names a ticker absent from the dataset', () => {
    const configResult = stockMarket4.parseConfig(
      marketDatasetConfigInput({ marketDataUniverse: ['NVDA', 'MISSING'] }),
    );
    if (!configResult.ok) throw new Error(configResult.reason);
    expect(() =>
      stockMarket4.initialize({ config: configResult.value, participantIds: PARTICIPANT_IDS, rng }),
    ).toThrow(/MISSING/);
  });

  it('throws a clear error when the referenced dataset version was never published', () => {
    const configResult = stockMarket4.parseConfig(
      marketDatasetConfigInput({
        marketDataset: { id: DATASET_ID, version: 'nope', dbPath },
      }),
    );
    if (!configResult.ok) throw new Error(configResult.reason);
    expect(() =>
      stockMarket4.initialize({ config: configResult.value, participantIds: PARTICIPANT_IDS, rng }),
    ).toThrow(/no published version/);
  });
});

describe('redactConfigForBots', () => {
  it('strips dbPath but keeps id/version when marketDataset is set', () => {
    const configResult = stockMarket4.parseConfig(marketDatasetConfigInput());
    if (!configResult.ok) throw new Error(configResult.reason);
    const redacted = stockMarket4.redactConfigForBots?.(configResult.value) as {
      marketDataset?: { id: string; version: string; dbPath?: string };
    };
    expect(redacted.marketDataset).toEqual({ id: DATASET_ID, version: DATASET_VERSION });
    expect(redacted.marketDataset?.dbPath).toBeUndefined();
  });

  it('has no marketDataset field at all in inline mode', () => {
    const configResult = stockMarket4.parseConfig(inlineConfigInput());
    if (!configResult.ok) throw new Error(configResult.reason);
    const redacted = stockMarket4.redactConfigForBots?.(configResult.value) as {
      marketDataset?: unknown;
    };
    expect(redacted.marketDataset).toBeUndefined();
  });
});
