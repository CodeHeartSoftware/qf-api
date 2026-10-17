import {
  benchmarkBuyAndHoldReturn,
  computePerformanceMetrics,
  type ExecutionConfig,
} from '@quant-fusion/game-stock-market-4';
import {
  formatStrategyTrace,
  type DailyBar,
  type EquityPoint,
  type TradingDecision,
} from '@quant-fusion/quant-sdk-js';
import { DEFAULT_FUSION_QUANT_CONFIG, type FusionQuantConfig } from '../src/config.js';
import { createDecideAction } from '../src/index.js';
import { REALISTIC_EXECUTION, replayThroughGame } from './gameReplay.js';
import { loadPriceSeriesFromMarketData } from './marketDataSeries.js';

const ANNUAL_RISK_FREE_RATE = 0.04;

const DEFAULT_PRICE_SERIES_BY_TICKER: Record<string, DailyBar[]> = loadPriceSeriesFromMarketData();

export interface BacktestResult {
  equityHistory: EquityPoint[];
  decisions: TradingDecision[];
  performance: ReturnType<typeof computePerformanceMetrics>;
  buyAndHoldReturnByTicker: Record<string, number | null>;
}

/**
 * Replays `DEFAULT_FUSION_QUANT_CONFIG` (or an override) through the real stock-market-4 game
 * engine (`gameReplay.ts`) against every security's real price history — the same fills, costs
 * and fees a real match gets. `execution` defaults to `REALISTIC_EXECUTION`.
 */
export function runBacktest(
  config: FusionQuantConfig = DEFAULT_FUSION_QUANT_CONFIG,
  priceSeriesByTicker: Record<string, DailyBar[]> = DEFAULT_PRICE_SERIES_BY_TICKER,
  startingCashCents = 10_000_000,
  execution: ExecutionConfig = REALISTIC_EXECUTION,
): BacktestResult {
  const decisions: TradingDecision[] = [];
  const { equityHistory } = replayThroughGame({
    decideAction: createDecideAction(config, (decision) => decisions.push(decision)),
    priceSeriesByTicker,
    startingCashCents,
    execution,
  });
  const performance = computePerformanceMetrics(equityHistory, ANNUAL_RISK_FREE_RATE);

  const buyAndHoldReturnByTicker: Record<string, number | null> = {};
  for (const [ticker, bars] of Object.entries(priceSeriesByTicker)) {
    const firstBar = bars[0];
    const lastBar = bars.at(-1);
    buyAndHoldReturnByTicker[ticker] =
      firstBar === undefined || lastBar === undefined ? null : benchmarkBuyAndHoldReturn(bars, firstBar.date, lastBar.date);
  }

  return { equityHistory, decisions, performance, buyAndHoldReturnByTicker };
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  const result = runBacktest();

  for (const decision of result.decisions) {
    process.stderr.write(`${formatStrategyTrace(decision, 'quant-v0')}\n\n`);
  }

  const finalEquityCents = result.equityHistory.at(-1)?.equityCents ?? null;
  const startingEquityCents = result.equityHistory[0]?.equityCents ?? null;
  const tradingDays = result.equityHistory.length;
  const tradeCount = result.decisions.filter((d) => d.action !== 'HOLD').length;

  process.stdout.write(
    `${JSON.stringify(
      {
        tradingDays,
        tradeCount,
        startingEquityCents,
        finalEquityCents,
        strategyReturn: result.performance.totalReturn,
        maxDrawdown: result.performance.maxDrawdown,
        annualizedVolatility: result.performance.annualizedVolatility,
        sharpeRatio: result.performance.sharpeRatio,
        buyAndHoldReturnByTicker: result.buyAndHoldReturnByTicker,
      },
      null,
      2,
    )}\n`,
  );
}
