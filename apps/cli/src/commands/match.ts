// `quant-fusion match run` — the registry-backed, real end-to-end match runner. Resolves
// bot/game ids through @quant-fusion/registry, builds each bot's Docker image on demand from its
// own manifest (no manual pre-build step), then drives a real match through @quant-fusion/engine
// and @quant-fusion/runtime — the registry-driven successor to an earlier ad hoc scrimmage script
// that proved the same wiring by hand against a hardcoded bot list.
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import type { RoundEvent } from '@quant-fusion/engine';
import { generateTournamentSeed } from '@quant-fusion/rng';
import {
  buildBotImages,
  loadGame,
  resolveBotsAndGame,
  runSingleMatch,
} from '../lib/match-execution.js';

const USAGE =
  'Usage: quant-fusion match run <botId> <botId> [...moreBotIds] ' +
  '[--config \'{"totalRounds":300}\' | --config-file <path>]';

/** Printing every round is fine for a handful of rounds, but floods the terminal at 300 — past
 * this threshold, just report how many rounds were played and let the final standings speak.
 * Exported so `tournament replay` (commands/tournament.ts) can print a persisted match's events
 * identically to how a live `match run`/`tournament run` would have shown them. */
export const MAX_ROUNDS_TO_PRINT_INDIVIDUALLY = 20;

/** Renders one trade as a human-readable line, or `null` if `trade` isn't shaped like one (in
 * which case the caller falls back to a raw dump). Both Stock Market 2
 * (games/stock-market-2/src/types.ts) and Stock Market 3 (games/stock-market-3/src/types.ts) emit
 * this same `Trade` shape — `buyerParticipantId`/`sellerParticipantId` (`null` means the other
 * side was synthetic external liquidity, not another participant), `priceCents`, `quantity`, an
 * optional `symbol` (only Stock Market 3 has more than one), and an optional `forced` flag (a
 * margin-call liquidation rather than the participant's own order). Read generically off
 * `unknown` rather than importing either game's types, so this stays game-agnostic. */
function describeTrade(trade: unknown): string | null {
  if (typeof trade !== 'object' || trade === null) {
    return null;
  }
  const { buyerParticipantId, sellerParticipantId, priceCents, quantity, symbol, forced } =
    trade as Record<string, unknown>;
  if (typeof priceCents !== 'number' || typeof quantity !== 'number') {
    return null;
  }
  const price = `$${(priceCents / 100).toFixed(2)}`;
  const symbolLabel = typeof symbol === 'string' ? `${symbol} ` : '';
  const forcedLabel = forced === true ? ' (forced liquidation)' : '';
  if (typeof buyerParticipantId === 'string') {
    const counterparty =
      typeof sellerParticipantId === 'string' ? sellerParticipantId : 'the market';
    return `${buyerParticipantId} bought ${String(quantity)} ${symbolLabel}@ ${price} from ${counterparty}${forcedLabel}`;
  }
  if (typeof sellerParticipantId === 'string') {
    return `${sellerParticipantId} sold ${String(quantity)} ${symbolLabel}@ ${price} to the market${forcedLabel}`;
  }
  return null;
}

/** Reads a round's trades off `data.trades`/`data.forcedLiquidations` generically (the shape both
 * Stock Market 2 and Stock Market 3's `round-result` events carry) and renders each as one
 * human-readable line. Returns `null` — meaning "not recognized" — for any other game's event
 * data, so `printRoundEvents` falls back to its original raw dump for those. */
function describeTradesFor(data: unknown): string[] | null {
  if (typeof data !== 'object' || data === null) {
    return null;
  }
  const { trades, forcedLiquidations } = data as Record<string, unknown>;
  if (!Array.isArray(trades) && !Array.isArray(forcedLiquidations)) {
    return null;
  }
  // `Array.isArray` is typed as `(arg: any) => arg is any[]`, so narrowing an `unknown` through it
  // still yields `any[]` — these explicit `unknown[]` annotations are what keep that `any` from
  // leaking into `all` below (an unsafe spread otherwise).
  const tradesArray: unknown[] = Array.isArray(trades) ? trades : [];
  const forcedLiquidationsArray: unknown[] = Array.isArray(forcedLiquidations)
    ? forcedLiquidations
    : [];
  const all = [...tradesArray, ...forcedLiquidationsArray];
  const lines: string[] = [];
  for (const trade of all) {
    const line = describeTrade(trade);
    if (line !== null) {
      lines.push(line);
    }
  }
  return lines;
}

export function printRoundEvents(events: RoundEvent[][]): void {
  if (events.length > MAX_ROUNDS_TO_PRINT_INDIVIDUALLY) {
    console.log(`  (${String(events.length)} rounds played)`);
    return;
  }
  events.forEach((rounds, roundIndex) => {
    for (const event of rounds) {
      const tradeLines = describeTradesFor(event.data);
      if (tradeLines === null) {
        console.log('  round-result:', event.data);
        continue;
      }
      if (tradeLines.length === 0) {
        continue; // nothing traded this round — skip rather than print an empty header
      }
      console.log(`  Round ${String(roundIndex)}:`);
      for (const line of tradeLines) {
        console.log(`    ${line}`);
      }
    }
  });
}

/** Not every game's result carries this — only a game made up of multiple sub-units beneath the
 * per-round event stream `printRoundEvents` already reports on, e.g. Hearts's `handsPlayed`
 * (games/card-game-hearts/src/types.ts). Reads it generically off whatever shape `result` happens
 * to be rather than hardcoding to Hearts, so any other such game gets this for free too — a no-op
 * for a game whose result has no such field. */
export function printHandsPlayed(result: unknown): void {
  if (typeof result !== 'object' || result === null) {
    return;
  }
  const { handsPlayed } = result as Record<string, unknown>;
  if (typeof handsPlayed === 'number') {
    console.log(`  (${String(handsPlayed)} hands played)`);
  }
}

/** Same "read it generically off `result`" idiom as `printHandsPlayed` above — a game's result
 * gets this line whether it carries `startingStockPrice`/`finalStockPrice` (Stock Market,
 * games/stock-market/src/types.ts), `startingPrice`/`finalPrice` (Stock Market 2,
 * games/stock-market-2/src/types.ts — renamed since that result also covers a SYNTHETIC-mode
 * ticker that isn't literally "the stock"), or `indexStartingPrice`/`indexFinalPrice` (Stock
 * Market 3, games/stock-market-3/src/types.ts — its own tradable index, not "the stock" either,
 * since there are several other securities alongside it). A no-op for every other game's result
 * shape. */
export function printStockPriceRange(result: unknown): void {
  if (typeof result !== 'object' || result === null) {
    return;
  }
  const {
    startingStockPrice,
    finalStockPrice,
    startingPrice,
    finalPrice,
    indexStartingPrice,
    indexFinalPrice,
    indexSymbol,
  } = result as Record<string, unknown>;
  const starting =
    typeof startingStockPrice === 'number'
      ? startingStockPrice
      : typeof startingPrice === 'number'
        ? startingPrice
        : indexStartingPrice;
  const final =
    typeof finalStockPrice === 'number'
      ? finalStockPrice
      : typeof finalPrice === 'number'
        ? finalPrice
        : indexFinalPrice;
  if (typeof starting === 'number' && typeof final === 'number') {
    const label = typeof indexSymbol === 'string' ? `${indexSymbol} price` : 'stock price';
    console.log(`  (${label}: $${starting.toFixed(2)} → $${final.toFixed(2)})`);
  }
}

/** Stock Market 3 (games/stock-market-3/src/types.ts) is the only game whose result currently
 * carries a `securityPrices` array — one entry per tradable security (including its own
 * synthetic index) with `symbol`/`startingPrice`/`finalPrice`. Read generically off `unknown` so
 * this stays a no-op for every other game's result shape, same idiom as `printStockPriceRange`. */
export function printSecurityPriceTable(result: unknown): void {
  if (typeof result !== 'object' || result === null) {
    return;
  }
  const { securityPrices } = result as Record<string, unknown>;
  if (!Array.isArray(securityPrices) || securityPrices.length === 0) {
    return;
  }
  console.log('  Security prices (before -> after):');
  for (const entry of securityPrices) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const { symbol, startingPrice, finalPrice } = entry as Record<string, unknown>;
    if (
      typeof symbol !== 'string' ||
      typeof startingPrice !== 'number' ||
      typeof finalPrice !== 'number'
    ) {
      continue;
    }
    const changePct =
      startingPrice !== 0 ? ((finalPrice - startingPrice) / startingPrice) * 100 : 0;
    const sign = changePct >= 0 ? '+' : '';
    console.log(
      `    ${symbol}: $${startingPrice.toFixed(2)} -> $${finalPrice.toFixed(2)} (${sign}${changePct.toFixed(1)}%)`,
    );
  }
}

/** Same idiom, for Stock Market 3's `portfolioSummaries` (participantId -> cash/equity/positions
 * at match end). A no-op for every other game's result shape. */
export function printPortfolioSummaries(result: unknown): void {
  if (typeof result !== 'object' || result === null) {
    return;
  }
  const { portfolioSummaries } = result as Record<string, unknown>;
  if (typeof portfolioSummaries !== 'object' || portfolioSummaries === null) {
    return;
  }
  const entries = Object.entries(portfolioSummaries as Record<string, unknown>);
  if (entries.length === 0) {
    return;
  }
  console.log('  Bot portfolios:');
  for (const [participantId, summaryRaw] of entries) {
    if (typeof summaryRaw !== 'object' || summaryRaw === null) {
      continue;
    }
    const { cash, equity, bankrupt, positions } = summaryRaw as Record<string, unknown>;
    if (typeof cash !== 'number' || typeof equity !== 'number') {
      continue;
    }
    const bankruptLabel = bankrupt === true ? ' [BANKRUPT]' : '';
    console.log(
      `    ${participantId}: equity $${equity.toFixed(2)}, cash $${cash.toFixed(2)}${bankruptLabel}`,
    );
    if (!Array.isArray(positions) || positions.length === 0) {
      console.log('      (no open positions)');
      continue;
    }
    for (const positionRaw of positions) {
      if (typeof positionRaw !== 'object' || positionRaw === null) {
        continue;
      }
      const { symbol, shares, averageEntryPrice, marketValue, unrealizedPnl } =
        positionRaw as Record<string, unknown>;
      if (
        typeof symbol !== 'string' ||
        typeof shares !== 'number' ||
        typeof averageEntryPrice !== 'number' ||
        typeof marketValue !== 'number' ||
        typeof unrealizedPnl !== 'number'
      ) {
        continue;
      }
      const pnlSign = unrealizedPnl >= 0 ? '+' : '';
      console.log(
        `      ${symbol}: ${String(shares)} sh @ avg $${averageEntryPrice.toFixed(2)}, value $${marketValue.toFixed(2)} (${pnlSign}$${unrealizedPnl.toFixed(2)} unrealized)`,
      );
    }
  }
}

/** Same "read it generically off `result`" idiom as the printers above, for stock-market-4's own
 * `performanceMetrics`/`benchmarkReturn` (games/stock-market-4/src/types.ts's `PerformanceMetrics`
 * — `totalReturn`, `maxDrawdown`, `annualizedVolatility`, and a `sharpeRatio` that's `null` on a
 * flat/no-trade equity curve rather than a divide-by-zero artifact). A no-op for any other game's
 * result shape, since none currently reports per-participant performance metrics this way. */
export function printPerformanceMetrics(result: unknown): void {
  if (typeof result !== 'object' || result === null) {
    return;
  }
  const { performanceMetrics, benchmarkReturn } = result as Record<string, unknown>;
  if (typeof performanceMetrics !== 'object' || performanceMetrics === null) {
    return;
  }
  const entries = Object.entries(performanceMetrics as Record<string, unknown>);
  if (entries.length === 0) {
    return;
  }
  console.log('  Portfolio statistics:');
  for (const [participantId, metricsRaw] of entries) {
    if (typeof metricsRaw !== 'object' || metricsRaw === null) {
      continue;
    }
    const { totalReturn, maxDrawdown, annualizedVolatility, sharpeRatio } = metricsRaw as Record<
      string,
      unknown
    >;
    if (
      typeof totalReturn !== 'number' ||
      typeof maxDrawdown !== 'number' ||
      typeof annualizedVolatility !== 'number'
    ) {
      continue;
    }
    const sharpeLabel = typeof sharpeRatio === 'number' ? sharpeRatio.toFixed(2) : 'n/a';
    console.log(
      `    ${participantId}: return ${(totalReturn * 100).toFixed(1)}%, max drawdown ${(maxDrawdown * 100).toFixed(1)}%, volatility ${(annualizedVolatility * 100).toFixed(1)}%, Sharpe ${sharpeLabel}`,
    );
  }
  if (typeof benchmarkReturn === 'number') {
    console.log(`    (benchmark buy-and-hold return: ${(benchmarkReturn * 100).toFixed(1)}%)`);
  }
}

/** Renders one `stock-market-4` `Fill` (games/stock-market-4/src/types.ts) as a human-readable
 * line, or `null` if `fill` isn't shaped like one. A `filledQuantity` of `0` is reported
 * explicitly ("no fill") rather than skipped — a bot that ASKED to trade and got nothing (no
 * cash/shares available, a LIMIT that never crossed, no bar that day) is meaningfully different
 * from a bot that submitted no orders at all, which `printForwardStandings` below already
 * reports separately ("held (no trades)"). */
function describeFill(fill: unknown): string | null {
  if (typeof fill !== 'object' || fill === null) {
    return null;
  }
  const { ticker, side, kind, requestedQuantity, filledQuantity, priceCents, feeCents } =
    fill as Record<string, unknown>;
  if (
    typeof ticker !== 'string' ||
    typeof side !== 'string' ||
    typeof filledQuantity !== 'number' ||
    typeof priceCents !== 'number'
  ) {
    return null;
  }
  if (filledQuantity === 0) {
    const requested = typeof requestedQuantity === 'number' ? String(requestedQuantity) : '?';
    return `${side} ${ticker}: requested ${requested}, filled 0 (no fill)`;
  }
  const kindLabel = typeof kind === 'string' && kind !== 'MARKET' ? ` (${kind})` : '';
  const feeLabel =
    typeof feeCents === 'number' && feeCents > 0 ? `, fee $${(feeCents / 100).toFixed(2)}` : '';
  return `${side} ${String(filledQuantity)} ${ticker}${kindLabel} @ $${(priceCents / 100).toFixed(2)}${feeLabel}`;
}

/**
 * Prints current standings/portfolio stats/today's fills from a `CurrentStandingsSummary`-shaped
 * object (games/stock-market-4/src/game.ts's `getCurrentStandings`) — read generically off
 * `unknown`, same idiom as every other printer in this file, so this stays a no-op for a game
 * that doesn't expose this shape rather than needing a hard dependency on stock-market-4's own
 * types. `participantIds` (not derived from `summary` itself) drives "what each bot did today" so
 * every participant gets a line even if `summary` reports zero standings for some reason.
 */
export function printForwardStandings(summary: unknown, participantIds: readonly string[]): void {
  if (typeof summary !== 'object' || summary === null) {
    return;
  }
  const { asOfDate, benchmarkReturn, standings } = summary as Record<string, unknown>;
  if (!Array.isArray(standings) || standings.length === 0) {
    return;
  }

  const dateLabel = typeof asOfDate === 'string' ? asOfDate : '(unknown date)';
  console.log(`\nStandings as of ${dateLabel}:`);
  const byParticipantId = new Map<string, Record<string, unknown>>();
  for (const entryRaw of standings) {
    if (typeof entryRaw !== 'object' || entryRaw === null) continue;
    const entry = entryRaw as Record<string, unknown>;
    const {
      participantId,
      rank,
      equityCents,
      cashCents,
      totalReturn,
      maxDrawdown,
      annualizedVolatility,
      sharpeRatio,
      positions,
    } = entry;
    if (
      typeof participantId !== 'string' ||
      typeof rank !== 'number' ||
      typeof equityCents !== 'number'
    ) {
      continue;
    }
    byParticipantId.set(participantId, entry);

    const sharpeLabel = typeof sharpeRatio === 'number' ? sharpeRatio.toFixed(2) : 'n/a';
    const returnLabel =
      typeof totalReturn === 'number' ? `, return ${(totalReturn * 100).toFixed(2)}%` : '';
    const drawdownLabel =
      typeof maxDrawdown === 'number' ? `, max drawdown ${(maxDrawdown * 100).toFixed(2)}%` : '';
    const volLabel =
      typeof annualizedVolatility === 'number'
        ? `, volatility ${(annualizedVolatility * 100).toFixed(2)}%`
        : '';
    const cashLabel =
      typeof cashCents === 'number' ? `, cash $${(cashCents / 100).toFixed(2)}` : '';
    console.log(
      `  ${String(rank)}. ${participantId}: equity $${(equityCents / 100).toFixed(2)}` +
        `${cashLabel}${returnLabel}${drawdownLabel}${volLabel}, Sharpe ${sharpeLabel}`,
    );

    if (!Array.isArray(positions) || positions.length === 0) continue;
    for (const positionRaw of positions) {
      if (typeof positionRaw !== 'object' || positionRaw === null) continue;
      const { ticker, shares, marketValueCents, unrealizedPnlCents } = positionRaw as Record<
        string,
        unknown
      >;
      if (typeof ticker !== 'string' || typeof shares !== 'number') continue;
      const valueLabel =
        typeof marketValueCents === 'number'
          ? `, value $${(marketValueCents / 100).toFixed(2)}`
          : '';
      const pnlLabel =
        typeof unrealizedPnlCents === 'number'
          ? ` (${unrealizedPnlCents >= 0 ? '+' : ''}$${(unrealizedPnlCents / 100).toFixed(2)} unrealized)`
          : '';
      console.log(`       ${ticker}: ${String(shares)} sh${valueLabel}${pnlLabel}`);
    }
  }
  if (typeof benchmarkReturn === 'number') {
    console.log(`  (benchmark buy-and-hold return so far: ${(benchmarkReturn * 100).toFixed(2)}%)`);
  }

  console.log(`\nWhat each bot did on ${dateLabel}:`);
  for (const participantId of participantIds) {
    const lastFills = byParticipantId.get(participantId)?.lastFills;
    if (!Array.isArray(lastFills) || lastFills.length === 0) {
      console.log(`  ${participantId}: held (no trades)`);
      continue;
    }
    console.log(`  ${participantId}:`);
    for (const fill of lastFills) {
      const line = describeFill(fill);
      if (line !== null) console.log(`    ${line}`);
    }
  }
}

export interface MatchRunOptions {
  /** Repo root to scan games/ and bots/ under. */
  rootDir: string;
}

export async function runMatchCommand(
  argv: readonly string[],
  options: MatchRunOptions,
): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv as string[],
    options: { config: { type: 'string' }, 'config-file': { type: 'string' } },
    allowPositionals: true,
  });

  const botIds = positionals;
  if (botIds.length < 2) {
    console.error(USAGE);
    return 1;
  }
  if (values.config !== undefined && values['config-file'] !== undefined) {
    console.error(`--config and --config-file are mutually exclusive.\n${USAGE}`);
    return 1;
  }

  const resolved = await resolveBotsAndGame(options.rootDir, botIds);
  if (!resolved.ok) {
    console.error(resolved.message);
    return 1;
  }
  const { entries, gameEntry } = resolved;

  // A researchTimeline-bearing config can run to megabytes — comfortably past a shell's argv
  // length limit for inline `--config` — same rationale as `match forward run`'s own
  // `--config-file` (see that command's own doc comment).
  let configString = values.config ?? '{}';
  if (values['config-file'] !== undefined) {
    try {
      configString = await readFile(values['config-file'], 'utf8');
    } catch (error) {
      console.error(
        `Could not read --config-file "${values['config-file']}": ${error instanceof Error ? error.message : String(error)}`,
      );
      return 1;
    }
  }

  let configRaw: unknown;
  try {
    configRaw = JSON.parse(configString);
  } catch (error) {
    console.error(
      `--config is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }

  const game = await loadGame(gameEntry);
  const configResult = game.parseConfig(configRaw);
  if (!configResult.ok) {
    console.error(`Invalid --config for game "${gameEntry.manifest.id}": ${configResult.reason}`);
    return 1;
  }
  const config = configResult.value;

  console.log(`Building ${String(entries.length)} bot image(s)...`);
  const imageTagsByBotId = await buildBotImages(entries);

  const roster = botIds;
  const matchId = `match-${String(Date.now())}`;
  const tournamentSeed = generateTournamentSeed(); // the one entropy boundary (ADR-0004)

  console.log(`\nMatch: ${roster.join(' vs ')} (${gameEntry.manifest.name})\n`);

  let outcome;
  try {
    outcome = await runSingleMatch({
      game,
      gameEntry,
      config,
      matchId,
      participantIds: roster,
      imageTagsByBotId,
      tournamentSeed,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  printRoundEvents(outcome.events);
  printHandsPlayed(outcome.result);
  printStockPriceRange(outcome.result);
  printSecurityPriceTable(outcome.result);
  printPortfolioSummaries(outcome.result);
  printPerformanceMetrics(outcome.result);
  console.log();

  if (outcome.status === 'forfeit') {
    console.log(`Forfeit: ${(outcome.forfeitedParticipantIds ?? []).join(', ')}`);
  } else if (outcome.status === 'match-timeout') {
    console.log(
      'Match hit its overall wall-clock budget without the game itself declaring an end — scored as a draw between all participants. This is a rare defense-in-depth case (see docs/adr/0003-docker-bot-isolation.md), not expected in normal play.',
    );
  }
  const standings = [...outcome.standingOutcomes].sort((a, b) => a.rank - b.rank);
  for (const standing of standings) {
    const parts = [`${String(standing.rank)}.`, standing.participantId];
    if (standing.outcome !== undefined) {
      parts.push(
        `(${standing.outcome}${standing.score !== undefined ? `, score=${String(standing.score)}` : ''})`,
      );
    }
    console.log(parts.join(' '));
  }

  return 0;
}
