import { loadForwardMatchRecord } from '@quant-fusion/forward-match-store';
import { startDetachedJob } from './detachedJobs.js';
import { fetchLatestPriceData } from './fetchLatestPriceData.js';
import { readForwardShadowFields } from './forwardShadowConfig.js';
import type { JobOutcome } from './jobRunner.js';
import { parseQuantDecisions } from './parseQuantDecisions.js';
import { defaultForwardMatchStoreDbPath } from './paths.js';
import { runCli, type CommandResult } from './subprocess.js';

export function dailyCycleHistoryJobId(matchId: string): string {
  return `daily-cycle:${matchId}`;
}

/** Starts a daily cycle as a detached job (see `detachedJobs.ts` for why detached) — shared by
 * the `/daily-cycle` route and the scheduler. Callers check `run:<matchId>` isn't busy first. */
export function startDailyCycleJob(
  rootDir: string,
  matchId: string,
  options: { repin: boolean; skipFetch?: boolean },
) {
  return startDetachedJob(rootDir, {
    kind: 'daily-cycle',
    label: `Daily cycle${options.repin ? ' (re-pin)' : ''} · ${matchId}`,
    key: `run:${matchId}`,
    script: 'apps/api/src/workers/dailyCycle.ts',
    args: [
      rootDir,
      matchId,
      ...(options.repin ? ['--repin'] : []),
      ...(options.skipFetch === true ? ['--skip-fetch'] : []),
    ],
  });
}

export interface BotPinStatus {
  botId: string;
  state: 'pinned' | 'drifted' | 'unpinned';
}

export interface DailyCycleResult {
  matchId: string;
  fetchedNewBars: boolean;
  /** Present only when the cycle stopped at the pin check — the bots whose code changed. */
  driftedBotIds?: string[];
  roundsPlayed?: number;
  decisions?: unknown[];
}

export interface DailyCycleOptions {
  matchId: string;
  repin: boolean;
  skipFetch?: boolean;
}

/** Injected so a test can drive the sequencing without Docker, Yahoo, or a built CLI. */
export interface DailyCycleDeps {
  fetchPrices: typeof fetchLatestPriceData;
  runCli: (rootDir: string, args: string[]) => Promise<CommandResult>;
}

const DEFAULT_DEPS: DailyCycleDeps = { fetchPrices: fetchLatestPriceData, runCli };

function parsePinStatus(stdout: string): BotPinStatus[] | undefined {
  try {
    const parsed = JSON.parse(stdout.trim()) as { bots?: unknown };
    return Array.isArray(parsed.bots) ? (parsed.bots as BotPinStatus[]) : undefined;
  } catch {
    return undefined;
  }
}

/** One "do today's work" pass for a forward match, as a single sequence instead of three separate
 * clicks:
 *
 * 1. Fetch the latest prices for the match's own dataset/universe, and WAIT for the
 *    `market-data` rebuild (the next step's fresh CLI process only sees new bars once `dist/` has
 *    them).
 * 2. Check pins (`match forward pin-status --json`) — a drifted bot stops the cycle with a clear
 *    "re-run with repin" outcome instead of `match forward run`'s refusal buried in a log.
 * 3. `match forward run`, which already plays EVERY newly available round in one invocation, so a
 *    few missed days catch up in one cycle.
 *
 * `log` narrates the steps; the spawned commands' own output streams into the same job log on its
 * own (see `jobOutputContext`). */
export async function runDailyCycle(
  rootDir: string,
  options: DailyCycleOptions,
  log: (line: string) => void,
  deps: DailyCycleDeps = DEFAULT_DEPS,
): Promise<JobOutcome & { result: DailyCycleResult }> {
  const { matchId, repin } = options;
  const result: DailyCycleResult = { matchId, fetchedNewBars: false };
  const fail = (summary: string) => ({ ok: false, summary, result });

  const outcome = await loadForwardMatchRecord(defaultForwardMatchStoreDbPath(rootDir), matchId);
  if (outcome.status === 'not-found') return fail(`No forward match "${matchId}".`);
  if (outcome.status === 'corrupt') return fail(outcome.reason);
  const { record } = outcome;
  if (record.status !== 'active') return fail(`"${matchId}" is already ${record.status}.`);

  if (options.skipFetch === true) {
    log('Step 1/3: skipping the price fetch (requested).');
  } else {
    const fields = readForwardShadowFields(record.config);
    if (fields === undefined) {
      log(
        'Step 1/3: no marketDataset/marketDataUniverse in this match’s config — skipping the price fetch.',
      );
    } else {
      log(
        `Step 1/3: fetching latest prices for ${String(fields.marketDataUniverse.length)} ticker(s)…`,
      );
      const fetched = await deps.fetchPrices(
        rootDir,
        {
          id: `match:${matchId}`,
          game: record.gameId,
          label: matchId,
          datasetId: fields.marketDataset.id,
          datasetVersion: fields.marketDataset.version,
          tickers: fields.marketDataUniverse,
        },
        { rebuild: 'await' },
      );
      result.fetchedNewBars = fetched.fetchedNewBars;
      log(fetched.note);
      if (!fetched.ok) {
        // A failed fetch (Yahoo hiccup, network) doesn't make running pointless — the match just
        // plays whatever data it already has, same as `match forward refresh` does.
        log('warning: the price fetch failed — continuing with the data already on hand.');
      }
    }
  }

  log('\nStep 2/3: checking bot pins…');
  const pinStatus = await deps.runCli(rootDir, [
    'match',
    'forward',
    'pin-status',
    matchId,
    '--json',
  ]);
  const bots = pinStatus.ok ? parsePinStatus(pinStatus.stdout) : undefined;
  if (bots === undefined) return fail('Could not read the match’s pin status (see the log).');
  const drifted = bots.filter((bot) => bot.state === 'drifted').map((bot) => bot.botId);
  if (drifted.length > 0 && !repin) {
    result.driftedBotIds = drifted;
    return fail(
      `${drifted.join(', ')} changed since this match was pinned — re-run with "Re-pin & run" to accept the new code.`,
    );
  }
  log(
    drifted.length > 0
      ? `Re-pinning ${drifted.join(', ')} to their current code.`
      : bots.some((bot) => bot.state === 'unpinned')
        ? 'Match is not pinned.'
        : 'All bots match their pinned code.',
  );

  log('\nStep 3/3: running every newly available round…');
  const run = await deps.runCli(rootDir, [
    'match',
    'forward',
    'run',
    matchId,
    ...record.participantIds,
    ...(drifted.length > 0 ? ['--repin'] : []),
  ]);
  result.decisions = parseQuantDecisions(run.output);
  const played = /played (\d+) new round\(s\) this invocation/.exec(run.output);
  if (played?.[1] !== undefined) result.roundsPlayed = Number(played[1]);
  if (!run.ok) return fail('`match forward run` failed — see the log.');

  const rounds = result.roundsPlayed ?? 0;
  return {
    ok: true,
    summary:
      rounds === 0
        ? 'No new trading days to play yet.'
        : `Played ${String(rounds)} new round(s)${result.fetchedNewBars ? ' after fetching new prices' : ''}.`,
    result,
  };
}
