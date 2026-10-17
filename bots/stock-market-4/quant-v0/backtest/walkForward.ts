import { computePerformanceMetrics, type ExecutionConfig } from '@quant-fusion/game-stock-market-4';
import {
  buildOrders,
  type DailyBar,
  type EquityPoint,
  type OrderPolicy,
  type OrderRequest,
  type PortfolioStrategyName,
  type ResearchAblationMode,
  type StockMarket4Observation,
  type TradingDecision,
} from '@quant-fusion/quant-sdk-js';
import { attributeToBasket, basketDailyReturns, type BasketAttribution } from './basketAttribution.js';
import { loadPriceSeriesFromMarketData } from './marketDataSeries.js';
import { LEGACY_EXECUTION, REALISTIC_EXECUTION, replayThroughGame } from './gameReplay.js';
import { computeReturnAttribution, type ReturnAttribution } from './returnAttribution.js';
import { DEFAULT_FUSION_QUANT_CONFIG, type FusionQuantConfig } from '../src/config.js';
import { createDecideAction as createQuantDecideAction } from '../src/index.js';

const ANNUAL_RISK_FREE_RATE = 0.04;

/** Every tracked ticker's full real series, from committed market data — see `marketDataSeries.ts`. */
export const FULL_PRICE_SERIES_BY_TICKER: Record<string, DailyBar[]> = loadPriceSeriesFromMarketData();

export type DecideAction = (observation: StockMarket4Observation) => { orders: OrderRequest[] };

/** Every real calendar date any tracked ticker has a bar for, sorted ascending — the SAME "union
 * of every ticker's own dates" trading calendar `runBacktest.ts` already uses. */
export function sharedTradingCalendar(priceSeriesByTicker: Record<string, DailyBar[]>): string[] {
  const allDates = new Set<string>();
  for (const bars of Object.values(priceSeriesByTicker)) for (const bar of bars) allDates.add(bar.date);
  return Array.from(allDates).sort();
}

/**
 * Replays ONE participant's `decideAction` through the real stock-market-4 game engine
 * (`gameReplay.ts`) — the same fills, costs, fees and point-in-time research a real match gets.
 * Bar `history` only ever contains bars at or before the current date and research is the game's
 * own timeline, so nothing here ever hands a decision a later bar or research fact. `dateLimit`
 * stops the replay early (used by `test/backtest/walkforward-leakage.test.ts` to prove a truncated
 * run reproduces the untruncated run's earlier decisions byte-for-byte). `execution` defaults to
 * `REALISTIC_EXECUTION` (next-open fills plus spread/impact/volume cap).
 */
export function replayParticipant(params: {
  decideAction: DecideAction;
  priceSeriesByTicker: Record<string, DailyBar[]>;
  startingCashCents: number;
  dateLimit?: string;
  execution?: ExecutionConfig;
}): { dates: string[]; equityHistory: EquityPoint[] } {
  return replayThroughGame(params);
}

const CONTROL_ORDER_POLICY: OrderPolicy = { minOrderNotionalCents: 5_000, rebalanceToleranceWeight: 0.03 };

/** Control: never trades — the "did this strategy even beat doing nothing" floor. */
export function createCashControlDecideAction(): DecideAction {
  return () => ({ orders: [] });
}

/** Control: on the FIRST round with any priced security, buys an equal dollar amount of every
 * priced ticker and never trades again — the classic buy-and-hold benchmark, at the PORTFOLIO
 * level (distinct from `runBacktest.ts`'s own per-ticker `benchmarkBuyAndHoldReturn`, which never
 * combines tickers into one held basket). */
export function createBuyAndHoldControlDecideAction(): DecideAction {
  let bought = false;
  return (observation) => {
    if (bought) return { orders: [] };
    const priced = observation.securities.filter((s) => s.bar !== null);
    if (priced.length === 0) return { orders: [] };
    bought = true;

    const orders: OrderRequest[] = [];
    let remainingCents = observation.portfolio.cashCents;
    const targetWeight = 1 / priced.length;
    for (const security of priced) {
      const priceCents = Math.round(security.bar!.close * 100);
      const budgetCents = Math.min(observation.portfolio.equityCents * targetWeight, remainingCents);
      const quantity = Math.floor(budgetCents / priceCents);
      if (quantity > 0) {
        orders.push({ kind: 'MARKET', ticker: security.ticker, side: 'BUY', quantity });
        remainingCents -= quantity * priceCents;
      }
    }
    return { orders };
  };
}

/** Control: rebalances to equal weight across every priced ticker EVERY round — the naive
 * "no alpha, no research, just diversify and rebalance" baseline every fancier strategy in this
 * harness has to actually beat. */
export function createEqualWeightControlDecideAction(): DecideAction {
  return (observation) => {
    const priced = observation.securities.filter((s) => s.bar !== null);
    if (priced.length === 0) return { orders: [] };
    const targetWeight = 1 / priced.length;
    const orders: OrderRequest[] = [];
    let remainingBuyingPowerCents =
      observation.portfolio.buyingPowerCents > 0 ? observation.portfolio.buyingPowerCents : Math.max(0, observation.portfolio.cashCents);
    for (const security of priced) {
      const generated = buildOrders({
        ticker: security.ticker,
        targetWeight,
        priceDollars: security.bar!.close,
        portfolio: observation.portfolio,
        policy: CONTROL_ORDER_POLICY,
        availableBuyingPowerCents: remainingBuyingPowerCents,
      });
      for (const order of generated) {
        if (order.side === 'BUY') {
          remainingBuyingPowerCents = Math.max(0, remainingBuyingPowerCents - order.quantity * Math.round(security.bar!.close * 100));
        }
      }
      orders.push(...generated);
    }
    return { orders };
  };
}

function quantVariantConfig(strategy: PortfolioStrategyName, ablationMode: ResearchAblationMode): FusionQuantConfig {
  return {
    ...DEFAULT_FUSION_QUANT_CONFIG,
    portfolioConstruction: { ...DEFAULT_FUSION_QUANT_CONFIG.portfolioConstruction, strategy },
    ablationMode,
  };
}

export interface Participant {
  name: string;
  createDecideAction: () => DecideAction | Promise<DecideAction>;
  /** Only a `quantParticipant` populates this — every `TradingDecision` its own `decideAction`
   * has produced so far, for `computeReturnAttribution`'s alpha/cost breakdown. `undefined` for
   * the frozen sibling bots (no alpha-factor concept in their older discrete-bucket design) and
   * the dumb controls (no alpha at all) — `runWalkForward` reports `returnAttribution: null` for
   * those rather than fabricating an attribution over data that was never computed. */
  decisions?: TradingDecision[];
}

/** Builds a quant-v0 variant `Participant` whose `decisions` array is filled by the SAME
 * `onDecision` hook `src/index.ts`'s own real-match logging already uses — the array reference is
 * shared between this `Participant` object and the `decideAction` closure `createDecideAction()`
 * returns, so a caller can read `decisions` any time after the replay that used this
 * `decideAction` has run. */
function quantParticipant(name: string, strategy: PortfolioStrategyName, ablationMode: ResearchAblationMode): Participant {
  const decisions: TradingDecision[] = [];
  return {
    name,
    createDecideAction: () =>
      createQuantDecideAction(quantVariantConfig(strategy, ablationMode), (decision) => {
        decisions.push(decision);
      }),
    decisions,
  };
}

/** Dynamically loads the sibling `quant-lite` model's built `dist/index.js` — a relative filesystem
 * import, not a package dependency (models aren't Yarn workspace members). The path is held in a
 * plain `string` so TypeScript treats the `import()` as fully dynamic rather than trying to resolve
 * type declarations for a dist that was never built with `declaration: true`. quant-lite's own
 * `createDecideAction` already defaults to its own config, so there's no config module to import. See `../../quant-lite/README.md` for what that bot actually does differently
 * from quant-v0. */
async function loadQuantLiteDecideAction(): Promise<DecideAction> {
  const indexPath: string = '../../quant-lite/dist/index.js';
  const indexModule = await import(indexPath);
  return indexModule.createDecideAction() as DecideAction;
}

export function buildParticipants(): Participant[] {
  return [
    quantParticipant('quant-v0 (equal_weight, full)', 'equal_weight', 'full'),
    quantParticipant('quant-v0 (inverse_volatility, full)', 'inverse_volatility', 'full'),
    quantParticipant('quant-v0 (risk_parity, full)', 'risk_parity', 'full'),
    quantParticipant('quant-v0 (inverse_volatility, null_research)', 'inverse_volatility', 'null_research'),
    quantParticipant('quant-v0 (inverse_volatility, research_only)', 'inverse_volatility', 'research_only'),
    quantParticipant('quant-v0 (inverse_volatility, price_only)', 'inverse_volatility', 'price_only'),
    { name: 'quant-lite (top-3, wide deadband)', createDecideAction: () => loadQuantLiteDecideAction() },
    { name: 'control: equal_weight (rebalanced every round)', createDecideAction: () => createEqualWeightControlDecideAction() },
    { name: 'control: buy_and_hold (equal-dollar, day 1)', createDecideAction: () => createBuyAndHoldControlDecideAction() },
    { name: 'control: cash (never trades)', createDecideAction: () => createCashControlDecideAction() },
  ];
}

export interface FoldWindow {
  index: number;
  startDate: string;
  endDate: string;
}

/** Splits `dates` into `numFolds` contiguous, roughly-equal, NON-overlapping windows, in
 * chronological order — the last fold absorbs any remainder. With this bot's currently-real
 * ~73-day calendar (Jul 1 - Sep 11 2026) and the default `numFolds: 3`, expect ~24-day folds — a
 * genuinely small sample; see this bot's own plan doc for why that is reported plainly here, not
 * treated as a settled result. */
export function splitIntoFolds(dates: string[], numFolds = 3): FoldWindow[] {
  if (dates.length === 0) return [];
  const foldSize = Math.ceil(dates.length / numFolds);
  const folds: FoldWindow[] = [];
  for (let i = 0; i < numFolds; i++) {
    const start = i * foldSize;
    if (start >= dates.length) break;
    const end = Math.min(start + foldSize, dates.length) - 1;
    folds.push({ index: i, startDate: dates[start]!, endDate: dates[end]! });
  }
  return folds;
}

function sliceEquityHistory(equityHistory: EquityPoint[], startDate: string, endDate: string): EquityPoint[] {
  return equityHistory.filter((point) => point.date >= startDate && point.date <= endDate);
}

export interface FoldMetrics {
  foldIndex: number;
  startDate: string;
  endDate: string;
  tradingDays: number;
  performance: ReturnType<typeof computePerformanceMetrics>;
}

export interface WalkForwardParticipantReport {
  name: string;
  foldMetrics: FoldMetrics[];
  aggregatePerformance: ReturnType<typeof computePerformanceMetrics>;
  /** One-factor regression on the tracked universe's equal-weight basket — see
   * `basketAttribution.ts`. `null` when there are too few days to regress. */
  vsBasket: BasketAttribution | null;
  /** The full alpha/beta/cost return-attribution decomposition (see `returnAttribution.ts`) —
   * `null` for a participant with no `decisions` captured (the frozen sibling bots, and the dumb
   * controls), which have no alpha-factor concept to attribute. */
  returnAttribution: ReturnAttribution | null;
}

export interface WalkForwardReport {
  folds: FoldWindow[];
  participants: WalkForwardParticipantReport[];
}

/**
 * Drops every bar dated before `startDate` (`YYYY-MM-DD`), so a replay starts trading on
 * `startDate` with no earlier history at all — a genuinely later start, not "watch earlier bars but
 * don't trade them." Throws on a malformed date, or one that leaves no bars at all, rather than
 * silently reporting an empty run.
 */
export function trimPriceSeriesFromDate(
  priceSeriesByTicker: Record<string, DailyBar[]>,
  startDate: string,
): Record<string, DailyBar[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    throw new Error(`startDate must be YYYY-MM-DD, got "${startDate}"`);
  }
  const trimmed = Object.fromEntries(
    Object.entries(priceSeriesByTicker).map(([ticker, bars]) => [
      ticker,
      bars.filter((bar) => bar.date >= startDate),
    ]),
  );
  if (sharedTradingCalendar(trimmed).length === 0) {
    throw new Error(`startDate ${startDate} is after the last available bar`);
  }
  return trimmed;
}

/**
 * Runs every participant (`buildParticipants`) through ONE continuous replay of the shared real
 * trading calendar (`replayParticipant`) — never restarting capital or state per fold, since a real
 * walk-forward equity curve is continuous; folds only slice the reporting, not the replay itself.
 * Reports BOTH per-fold and aggregate performance, using the game's own
 * `computePerformanceMetrics` (never reimplemented) for every slice.
 *
 * The plan's own load-bearing caveat, restated here in code form: with only ~73 days of real
 * price history, `numFolds: 3` gives ~24-day folds — real out-of-sample slices, correctly isolated
 * from each other and from the future, but a small enough sample that no single number here should
 * be read as a settled verdict on any strategy. This gets more meaningful as
 * `packages/stock-market-4/market-data/scripts/fetchAndAppendBars.ts` accumulates more real history.
 */
export async function runWalkForward(params: {
  priceSeriesByTicker?: Record<string, DailyBar[]>;
  startingCashCents?: number;
  numFolds?: number;
  /** `YYYY-MM-DD` — when given, every participant starts trading on this date, with no bars from
   * before it (see `trimPriceSeriesFromDate`). Omitted means the full available history. */
  startDate?: string;
  /** Fill timing and trading costs — defaults to `REALISTIC_EXECUTION`. */
  execution?: ExecutionConfig;
} = {}): Promise<WalkForwardReport> {
  const fullPriceSeriesByTicker = params.priceSeriesByTicker ?? FULL_PRICE_SERIES_BY_TICKER;
  const priceSeriesByTicker =
    params.startDate === undefined
      ? fullPriceSeriesByTicker
      : trimPriceSeriesFromDate(fullPriceSeriesByTicker, params.startDate);
  const startingCashCents = params.startingCashCents ?? 10_000_000;
  const dates = sharedTradingCalendar(priceSeriesByTicker);
  const folds = splitIntoFolds(dates, params.numFolds ?? 3);

  const basketReturnByDate = basketDailyReturns(priceSeriesByTicker);

  const participants: WalkForwardParticipantReport[] = [];
  for (const participant of buildParticipants()) {
    const decideAction = await participant.createDecideAction();
    const { equityHistory } = replayParticipant({
      decideAction,
      priceSeriesByTicker,
      startingCashCents,
      execution: params.execution ?? REALISTIC_EXECUTION,
    });

    const foldMetrics: FoldMetrics[] = folds.map((fold) => {
      const slice = sliceEquityHistory(equityHistory, fold.startDate, fold.endDate);
      return {
        foldIndex: fold.index,
        startDate: fold.startDate,
        endDate: fold.endDate,
        tradingDays: slice.length,
        performance: computePerformanceMetrics(slice, ANNUAL_RISK_FREE_RATE),
      };
    });

    participants.push({
      name: participant.name,
      foldMetrics,
      aggregatePerformance: computePerformanceMetrics(equityHistory, ANNUAL_RISK_FREE_RATE),
      vsBasket: attributeToBasket(equityHistory, basketReturnByDate),
      returnAttribution:
        participant.decisions === undefined
          ? null
          : computeReturnAttribution(participant.decisions, equityHistory, basketReturnByDate),
    });
  }

  return { folds, participants };
}

/** mean / sample stdev / min / max of one metric across start dates (`null`s skipped). */
export interface MetricSpread {
  mean: number;
  stdev: number;
  min: number;
  max: number;
  count: number;
}

function spreadOf(values: (number | null | undefined)[]): MetricSpread | null {
  const xs = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (xs.length === 0) return null;
  const mean = xs.reduce((sum, x) => sum + x, 0) / xs.length;
  const stdev = xs.length < 2 ? 0 : Math.sqrt(xs.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (xs.length - 1));
  return { mean, stdev, min: Math.min(...xs), max: Math.max(...xs), count: xs.length };
}

export interface MultiStartParticipantSummary {
  name: string;
  totalReturn: MetricSpread | null;
  sharpeRatio: MetricSpread | null;
  maxDrawdown: MetricSpread | null;
  beta: MetricSpread | null;
  annualizedAlpha: MetricSpread | null;
  residualSharpe: MetricSpread | null;
  /** Fraction of start dates with positive annualized alpha vs. the basket — see the README's
   * paper-trading gate. `null` when no start had enough days to regress. */
  positiveAlphaShare: number | null;
}

export interface MultiStartReport {
  startDates: string[];
  participants: MultiStartParticipantSummary[];
}

/**
 * Runs the whole walk-forward once per start date and summarizes each participant's aggregate
 * metrics across them. A single start date has already been shown to swing a result by ~10
 * points, so any comparison between variants should be read off these spreads, not one run.
 */
export async function runMultiStart(params: {
  startDates: string[];
  priceSeriesByTicker?: Record<string, DailyBar[]>;
  startingCashCents?: number;
  numFolds?: number;
  execution?: ExecutionConfig;
}): Promise<MultiStartReport> {
  const reports: WalkForwardReport[] = [];
  for (const startDate of params.startDates) {
    reports.push(await runWalkForward({ ...params, startDate }));
  }
  const names = reports[0]?.participants.map((p) => p.name) ?? [];
  return {
    startDates: params.startDates,
    participants: names.map((name) => {
      const runs = reports.map((r) => r.participants.find((p) => p.name === name)!);
      return {
        name,
        totalReturn: spreadOf(runs.map((r) => r.aggregatePerformance.totalReturn)),
        sharpeRatio: spreadOf(runs.map((r) => r.aggregatePerformance.sharpeRatio)),
        maxDrawdown: spreadOf(runs.map((r) => r.aggregatePerformance.maxDrawdown)),
        beta: spreadOf(runs.map((r) => r.vsBasket?.beta)),
        annualizedAlpha: spreadOf(runs.map((r) => r.vsBasket?.annualizedAlpha)),
        residualSharpe: spreadOf(runs.map((r) => r.vsBasket?.residualSharpe)),
        positiveAlphaShare: (() => {
          const alphas = runs.flatMap((r) => (r.vsBasket === null ? [] : [r.vsBasket.annualizedAlpha]));
          return alphas.length === 0 ? null : alphas.filter((a) => a > 0).length / alphas.length;
        })(),
      };
    }),
  };
}

/** `--flag value` or `--flag=value`; a bare trailing `--flag` yields `''` so the caller's own
 * validation rejects it instead of silently ignoring the flag. */
function parseFlag(argv: string[], flag: string): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === flag) return argv[i + 1] ?? '';
    if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1);
  }
  return undefined;
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
// `--start-date YYYY-MM-DD` runs one walk-forward from that date; `--start-dates a,b,c` runs one
// per date and prints the cross-start summary instead. `--execution legacy` reproduces the old
// same-close, cost-free fills; the default is realistic (next-open fills plus trading costs).
if (isMainModule) {
  const argv = process.argv.slice(2);
  const startDates = parseFlag(argv, '--start-dates');
  const executionFlag = parseFlag(argv, '--execution') ?? 'realistic';
  if (executionFlag !== 'realistic' && executionFlag !== 'legacy') {
    throw new Error(`--execution must be "realistic" or "legacy", got "${executionFlag}"`);
  }
  const execution = executionFlag === 'legacy' ? LEGACY_EXECUTION : REALISTIC_EXECUTION;
  const run: () => Promise<unknown> =
    startDates !== undefined
      ? () => runMultiStart({ startDates: startDates.split(',').map((d) => d.trim()), execution })
      : () => runWalkForward({ startDate: parseFlag(argv, '--start-date'), execution });
  run()
    .then((report) => {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    })
    .catch((error: unknown) => {
      process.stderr.write(`walkForward failed: ${String(error)}\n`);
      process.exitCode = 1;
    });
}
