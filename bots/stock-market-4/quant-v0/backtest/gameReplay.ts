import {
  REALISTIC_EXECUTION,
  stockMarket4,
  type ExecutionConfig,
  type StockMarket4Observation as GameObservation,
  type StockMarket4State,
} from '@quant-fusion/game-stock-market-4';
import { buildResearchTimeline, createFusionFixtureDataset } from '@quant-fusion/research-fusion';
import { createRng } from '@quant-fusion/rng';
import type { DailyBar, EquityPoint, OrderRequest, StockMarket4Observation } from '@quant-fusion/quant-sdk-js';

export type DecideAction = (observation: StockMarket4Observation) => { orders: OrderRequest[] };

export { REALISTIC_EXECUTION };

/** The game's original fill model — same-close MARKET fills, no spread/impact/volume cap. Only for
 * reproducing pre-2026-09 numbers; it lets a strategy trade on a close it already knows. */
export const LEGACY_EXECUTION: ExecutionConfig = {
  fillTiming: 'same_close',
  halfSpreadBps: 0,
  impactCoefficientBps: 0,
  maxAdvParticipation: null,
  advWindowDays: 20,
};

const PARTICIPANT_ID = 'bot';
const dataset = createFusionFixtureDataset();
const researchTimelineByEndDate = new Map<string, ReturnType<typeof buildResearchTimeline>>();

function researchTimelineThrough(endDate: string) {
  let timeline = researchTimelineByEndDate.get(endDate);
  if (timeline === undefined) {
    timeline = buildResearchTimeline(dataset, endDate);
    researchTimelineByEndDate.set(endDate, timeline);
  }
  return timeline;
}

/** Every weekday in [start, end] that no ticker has a bar for — declared as a holiday so the game
 * doesn't play empty rounds the harness never used to have. */
function holidaysBetween(start: string, end: string, tradedDates: ReadonlySet<string>): string[] {
  const holidays: string[] = [];
  for (let ms = Date.parse(`${start}T00:00:00Z`); ms <= Date.parse(`${end}T00:00:00Z`); ms += 86_400_000) {
    const date = new Date(ms).toISOString().slice(0, 10);
    const day = new Date(ms).getUTCDay();
    if (day !== 0 && day !== 6 && !tradedDates.has(date)) holidays.push(date);
  }
  return holidays;
}

/**
 * Replays ONE participant through the real `stock-market-4` game engine, in process — the same
 * `initialize`/`getObservation`/`resolve` a Docker-backed match runs, including its fill timing,
 * trading costs, fees, cash constraints and point-in-time research timeline. Replaces the
 * harness's old hand-rolled ledger (same-close fills, no fees), which is how the harness and a real
 * match came to disagree by ~25 points. `dateLimit` stops the replay early (leakage test).
 */
export function replayThroughGame(params: {
  decideAction: DecideAction;
  priceSeriesByTicker: Record<string, DailyBar[]>;
  startingCashCents: number;
  execution?: ExecutionConfig;
  transactionFeeRate?: number;
  dateLimit?: string;
}): { dates: string[]; equityHistory: EquityPoint[] } {
  const inWindow = (bar: DailyBar) => params.dateLimit === undefined || bar.date <= params.dateLimit;
  const series = Object.fromEntries(
    Object.entries(params.priceSeriesByTicker)
      .map(([ticker, bars]) => [ticker, bars.filter(inWindow)] as const)
      .filter(([, bars]) => bars.length > 0),
  );
  const tradedDates = new Set(Object.values(series).flatMap((bars) => bars.map((bar) => bar.date)));
  const dates = [...tradedDates].sort();
  const startDate = dates[0];
  const endDate = dates.at(-1);
  if (startDate === undefined || endDate === undefined || startDate === endDate) {
    throw new Error('replayThroughGame needs at least two trading days of price data');
  }

  const parsed = stockMarket4.parseConfig({
    gameType: 'HISTORICAL',
    startDate,
    endDate,
    marketDataUniverse: Object.keys(series),
    historicalPrices: series,
    tradingHolidays: holidaysBetween(startDate, endDate, tradedDates),
    historicalContextDays: 250,
    startingCapital: params.startingCashCents / 100,
    transactionFeeRate: params.transactionFeeRate ?? 0.001,
    execution: params.execution ?? REALISTIC_EXECUTION,
    researchTimeline: researchTimelineThrough(endDate),
  });
  if (!parsed.ok) throw new Error(`replayThroughGame: invalid game config: ${parsed.reason}`);

  const rng = createRng(Buffer.alloc(16, 7));
  let state: StockMarket4State = stockMarket4.initialize({ config: parsed.value, participantIds: [PARTICIPANT_ID], rng });
  while (!stockMarket4.isTerminal(state)) {
    const observation: GameObservation = stockMarket4.getObservation(state, PARTICIPANT_ID);
    const raw = params.decideAction(observation as unknown as StockMarket4Observation);
    const validated = stockMarket4.validateAction(state, PARTICIPANT_ID, raw);
    const action = validated.ok ? validated.value : { orders: [] };
    state = stockMarket4.resolve({ state, actions: new Map([[PARTICIPANT_ID, action]]), rng }).nextState;
  }
  // Drop the game's pre-trading seed point: the harness's metrics and folds expect one point per
  // trading day, and the seed shares round 0's date.
  return { dates, equityHistory: (state.equityHistory.get(PARTICIPANT_ID) ?? []).slice(1) };
}
