import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { saveForwardMatchRecord, type ForwardMatchRecord } from '@quant-fusion/forward-match-store';
import { listJobRuns } from '@quant-fusion/job-run-store';
import { createMarketDataStore, publishDatasetVersion } from '@quant-fusion/market-data';
import { game, serializeForwardState } from '@quant-fusion/game-stock-market-4';
import { createRng } from '@quant-fusion/rng';
import { runDailyCycle, type DailyCycleDeps } from '../src/lib/dailyCycle.js';
import { isScheduleDue } from '../src/lib/dailyCycleScheduler.js';
import { getJob, resetJobsForTests, runAsLiveJob, startJob } from '../src/lib/jobRunner.js';
import { defaultForwardMatchStoreDbPath, defaultJobRunStoreDbPath } from '../src/lib/paths.js';
import { runCommand, type CommandResult } from '../src/lib/subprocess.js';

let rootDir: string;

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), 'sm4-api-daily-cycle-'));
  resetJobsForTests();
});

afterEach(() => {
  rmSync(rootDir, { recursive: true, force: true });
});

async function saveMatch(status: ForwardMatchRecord['status'] = 'active'): Promise<void> {
  const bars = ['2026-01-05', '2026-01-06'].map((date) => ({
    date,
    open: 10,
    high: 10,
    low: 10,
    close: 10,
    volume: 1000,
  }));
  const published = publishDatasetVersion(
    createMarketDataStore(join(rootDir, 'md.sqlite')),
    { id: 'test-ds', version: '1' },
    { bars: { FAST: bars } },
  );
  if (!published.ok) throw new Error(published.reason);
  const configResult = game.parseConfig({
    startDate: '2026-01-05',
    endDate: '2026-01-09',
    marketDataUniverse: ['FAST'],
    historicalContextDays: 10,
    gameType: 'FORWARD_SHADOW',
    marketDataset: { id: 'test-ds', version: '1', dbPath: join(rootDir, 'md.sqlite') },
  });
  if (!configResult.ok) throw new Error(configResult.reason);
  const state = game.initialize({
    config: configResult.value,
    participantIds: ['bot-a'],
    rng: createRng(Buffer.alloc(16, 7)),
  });
  const saved = await saveForwardMatchRecord(defaultForwardMatchStoreDbPath(rootDir), {
    matchId: 'm1',
    gameId: 'stock-market-4',
    gameVersion: '0.1.0',
    config: configResult.value,
    participantIds: ['bot-a'],
    matchSeed: '01'.repeat(16),
    createdAt: '2026-01-05T00:00:00.000Z',
    updatedAt: '2026-01-05T00:00:00.000Z',
    status,
    roundsPlayed: 0,
    snapshot: serializeForwardState(state),
  });
  if (!saved.ok) throw new Error(saved.reason);
}

function cliResult(output: string, ok = true): CommandResult {
  return { ok, exitCode: ok ? 0 : 1, output, stdout: output };
}

/** Records every CLI call; answers pin-status with `pinStates` and run with `runOutput`. */
function fakeDeps(
  pinStates: Record<string, string>,
  runOutput = 'played 2 new round(s) this invocation (2 total).',
) {
  const calls: string[][] = [];
  const deps: DailyCycleDeps = {
    fetchPrices: (_root, universe) =>
      Promise.resolve({
        ok: true,
        universeId: universe.id,
        datasetId: universe.datasetId,
        datasetVersion: universe.datasetVersion,
        tickers: [...universe.tickers],
        fetchedNewBars: true,
        output: '',
        note: 'fetched',
      }),
    runCli: (_root, args) => {
      calls.push(args);
      if (args[2] === 'pin-status') {
        const bots = Object.entries(pinStates).map(([botId, state]) => ({ botId, state }));
        return Promise.resolve(cliResult(JSON.stringify({ matchId: 'm1', bots })));
      }
      return Promise.resolve(cliResult(runOutput));
    },
  };
  return { deps, calls };
}

describe('runDailyCycle', () => {
  it('fetches, checks pins, then runs — reporting rounds played', async () => {
    await saveMatch();
    const { deps, calls } = fakeDeps({ 'bot-a': 'pinned' });
    const outcome = await runDailyCycle(
      rootDir,
      { matchId: 'm1', repin: false },
      () => undefined,
      deps,
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.result).toMatchObject({ fetchedNewBars: true, roundsPlayed: 2 });
    expect(calls.map((c) => c[2])).toEqual(['pin-status', 'run']);
    expect(calls[1]).not.toContain('--repin');
  });

  it('stops before running when a bot drifted and repin was not requested', async () => {
    await saveMatch();
    const { deps, calls } = fakeDeps({ 'bot-a': 'drifted' });
    const outcome = await runDailyCycle(
      rootDir,
      { matchId: 'm1', repin: false },
      () => undefined,
      deps,
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.result.driftedBotIds).toEqual(['bot-a']);
    expect(calls.map((c) => c[2])).toEqual(['pin-status']);
  });

  it('passes --repin through when a drifted bot is explicitly re-pinned', async () => {
    await saveMatch();
    const { deps, calls } = fakeDeps({ 'bot-a': 'drifted' });
    const outcome = await runDailyCycle(
      rootDir,
      { matchId: 'm1', repin: true },
      () => undefined,
      deps,
    );
    expect(outcome.ok).toBe(true);
    expect(calls[1]).toContain('--repin');
  });

  it('refuses a match that is no longer active, without touching the CLI', async () => {
    await saveMatch('completed');
    const { deps, calls } = fakeDeps({});
    const outcome = await runDailyCycle(
      rootDir,
      { matchId: 'm1', repin: false },
      () => undefined,
      deps,
    );
    expect(outcome.ok).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe('jobRunner', () => {
  it('streams spawned command output into the job and records history', async () => {
    const { job, done } = startJob(rootDir, {
      kind: 'test',
      label: 'test job',
      historyJobId: 'test-job',
      run: async (ctx) => {
        ctx.log('step 1');
        const result = await runCommand(process.execPath, ['-e', 'console.log("from child")'], {
          cwd: rootDir,
        });
        return { ok: result.ok, summary: 'all good' };
      },
    });
    expect(job.status).toBe('running');
    const finished = await done;
    expect(finished.status).toBe('succeeded');
    expect(getJob(job.id)?.output).toContain('step 1\nfrom child');
    const history = listJobRuns(defaultJobRunStoreDbPath(rootDir), 'test-job');
    expect(history.ok && history.value[0]?.summary).toBe('all good');
  });

  it('marks a throwing job failed instead of rejecting', async () => {
    const { done } = startJob(rootDir, {
      kind: 'test',
      label: 'boom',
      run: () => Promise.reject(new Error('boom')),
    });
    const finished = await done;
    expect(finished.status).toBe('failed');
    expect(finished.summary).toBe('boom');
  });

  it('runAsLiveJob returns the wrapped value unchanged', async () => {
    const value = await runAsLiveJob(rootDir, { kind: 'test', label: 'wrap' }, () =>
      Promise.resolve({ ok: false, extra: 42 }),
    );
    expect(value).toEqual({ ok: false, extra: 42 });
  });
});

describe('isScheduleDue', () => {
  const schedule = { enabled: true, timeLocal: '17:30', matchIds: ['m1'] };
  // 2026-10-07 is a Wednesday.
  const wednesdayAt = (h: number, m: number) => new Date(2026, 9, 7, h, m);

  it('fires on a weekday at/after the configured time', () => {
    expect(isScheduleDue(schedule, wednesdayAt(17, 30))).toBe(true);
    expect(isScheduleDue(schedule, wednesdayAt(17, 29))).toBe(false);
  });

  it('never fires twice the same day, on weekends, or when disabled', () => {
    expect(
      isScheduleDue({ ...schedule, lastTriggeredDate: '2026-10-07' }, wednesdayAt(18, 0)),
    ).toBe(false);
    expect(isScheduleDue(schedule, new Date(2026, 9, 10, 18, 0))).toBe(false); // Saturday
    expect(isScheduleDue({ ...schedule, enabled: false }, wednesdayAt(18, 0))).toBe(false);
    expect(isScheduleDue({ ...schedule, matchIds: [] }, wednesdayAt(18, 0))).toBe(false);
  });
});
