import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import {
  loadForwardMatchRecord,
  saveForwardMatchRecord,
  type ForwardMatchRecord,
} from '@quant-fusion/forward-match-store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  runMatchForwardEndCommand,
  runMatchForwardInspectCommand,
  runMatchForwardListCommand,
  runMatchForwardRunCommand,
} from '../src/commands/matchForward.js';

/**
 * Unit-level coverage against the REAL registry (the actual repo, not a fixture) — every path
 * here returns before ever touching Docker (bad input, a not-yet-existing/corrupt/already-
 * resolved record), matching `match.integration.test.ts`'s "unknown bot id" case, which is the
 * same kind of pre-Docker validation. The real end-to-end "plays real rounds against a real
 * Docker bot" path is already proven at the mechanism level by
 * `games/stock-market-4/test/forwardResumability.test.ts` and
 * `packages/engine/test/match-runner.test.ts`'s `runAvailableRounds` suite — this file exercises
 * the CLI's own wiring/validation logic around that already-tested mechanism.
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

// See `@quant-fusion/market-data`'s `src/store/db.ts` for why `node:sqlite` is loaded this way.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: typeof DatabaseSyncType;
};

let dbPath: string;
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'quant-fusion-match-forward-test-'));
  dbPath = join(root, 'db.sqlite');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function sampleRecord(overrides: Partial<ForwardMatchRecord> = {}): ForwardMatchRecord {
  return {
    matchId: 'test-forward-match',
    gameId: 'stock-market-4',
    gameVersion: '0.1.0',
    config: { gameType: 'FORWARD_SHADOW' },
    participantIds: ['quant-v0'],
    matchSeed: 'deadbeef',
    createdAt: '2026-09-10T00:00:00.000Z',
    updatedAt: '2026-09-10T00:00:00.000Z',
    status: 'active',
    roundsPlayed: 0,
    snapshot: { round: 0 },
    ...overrides,
  };
}

describe('runMatchForwardRunCommand: validation paths (no Docker touched)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exits 1 with usage when matchId or bot ids are missing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await runMatchForwardRunCommand([], { rootDir: repoRoot })).toBe(1);
    expect(await runMatchForwardRunCommand(['only-a-match-id'], { rootDir: repoRoot })).toBe(1);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('Usage: quant-fusion match forward run'),
    );
  });

  it('exits 1 for an unknown bot id', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const code = await runMatchForwardRunCommand(
      ['new-match', 'not-a-real-bot', '--config', '{}', '--store-dir', dbPath],
      { rootDir: repoRoot },
    );
    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Unknown bot id'));
  });

  it('exits 1 when creating a new match without --config', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const code = await runMatchForwardRunCommand(['new-match', 'quant-v0', '--store-dir', dbPath], {
      rootDir: repoRoot,
    });
    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('provide --config'));
  });

  it('exits 1 for invalid --config JSON', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const code = await runMatchForwardRunCommand(
      ['new-match', 'quant-v0', '--config', 'not json{{', '--store-dir', dbPath],
      { rootDir: repoRoot },
    );
    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('not valid JSON'));
  });

  it('exits 1 when --config is missing required fields the game itself rejects', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const code = await runMatchForwardRunCommand(
      ['new-match', 'quant-v0', '--config', '{}', '--store-dir', dbPath],
      { rootDir: repoRoot },
    );
    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Invalid --config'));
  });

  it('exits 1 when --config omits gameType: FORWARD_SHADOW', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const code = await runMatchForwardRunCommand(
      [
        'new-match',
        'quant-v0',
        '--config',
        JSON.stringify({
          startDate: '2026-01-05',
          endDate: '2026-01-09',
          marketDataUniverse: ['ELMT'],
          historicalPrices: {
            ELMT: [{ date: '2026-01-05', open: 1, high: 1, low: 1, close: 1, volume: 1 }],
          },
        }),
        '--store-dir',
        dbPath,
      ],
      { rootDir: repoRoot },
    );
    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('FORWARD_SHADOW'));
  });

  it('accepts --config-file in place of inline --config', async () => {
    const configPath = join(root, 'config.json');
    await writeFile(configPath, JSON.stringify({ gameType: 'FORWARD_SHADOW' }), 'utf8');

    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const code = await runMatchForwardRunCommand(
      ['new-match', 'not-a-real-bot', '--config-file', configPath, '--store-dir', dbPath],
      { rootDir: repoRoot },
    );
    // Reaches the same "unknown bot id" failure --config '{}' would — proves the file's contents
    // were read and parsed, not that --config-file was silently ignored.
    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Unknown bot id'));
  });

  it('exits 1 when both --config and --config-file are given', async () => {
    const configPath = join(root, 'config.json');
    await writeFile(configPath, '{}', 'utf8');

    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const code = await runMatchForwardRunCommand(
      [
        'new-match',
        'quant-v0',
        '--config',
        '{}',
        '--config-file',
        configPath,
        '--store-dir',
        dbPath,
      ],
      { rootDir: repoRoot },
    );
    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('mutually exclusive'));
  });

  it('exits 1 when --config-file does not exist', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const code = await runMatchForwardRunCommand(
      ['new-match', 'quant-v0', '--config-file', join(root, 'missing.json'), '--store-dir', dbPath],
      { rootDir: repoRoot },
    );
    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Could not read --config-file'));
  });

  it('exits 1 for a corrupt existing record, never silently creating a fresh match', async () => {
    await saveForwardMatchRecord(dbPath, sampleRecord({ matchId: 'broken' }));
    const db = new DatabaseSync(dbPath);
    db.prepare("UPDATE forward_matches SET snapshot = 'not json{{{' WHERE match_id = ?").run(
      'broken',
    );
    db.close();

    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const code = await runMatchForwardRunCommand(['broken', 'quant-v0', '--store-dir', dbPath], {
      rootDir: repoRoot,
    });
    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('unparseable JSON'));
  });

  it('exits 1 when resuming a match recorded for a different game', async () => {
    const record = sampleRecord({ matchId: 'wrong-game', gameId: 'connect-four' });
    const saved = await saveForwardMatchRecord(dbPath, record);
    expect(saved.ok).toBe(true);

    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const code = await runMatchForwardRunCommand(
      ['wrong-game', 'quant-v0', '--store-dir', dbPath],
      { rootDir: repoRoot },
    );
    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('was created for game "connect-four"'),
    );
  });

  it('exits 0 without touching Docker when resuming an already-completed match', async () => {
    const record = sampleRecord({ matchId: 'already-done', status: 'completed' });
    const saved = await saveForwardMatchRecord(dbPath, record);
    expect(saved.ok).toBe(true);

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const code = await runMatchForwardRunCommand(
      ['already-done', 'quant-v0', '--store-dir', dbPath],
      { rootDir: repoRoot },
    );
    expect(code).toBe(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('already completed'));
  });
});

describe('runMatchForwardListCommand', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports no matches when the store is empty', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const code = await runMatchForwardListCommand(['--store-dir', dbPath], { rootDir: repoRoot });
    expect(code).toBe(0);
    expect(log).toHaveBeenCalledWith('No forward matches recorded yet.');
  });

  it('lists every valid record and warns about a corrupt one without hiding the rest', async () => {
    await saveForwardMatchRecord(dbPath, sampleRecord({ matchId: 'valid-one' }));
    await saveForwardMatchRecord(dbPath, sampleRecord({ matchId: 'corrupt-one' }));
    const db = new DatabaseSync(dbPath);
    db.prepare("UPDATE forward_matches SET snapshot = 'not json{{{' WHERE match_id = ?").run(
      'corrupt-one',
    );
    db.close();

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const code = await runMatchForwardListCommand(['--store-dir', dbPath], { rootDir: repoRoot });

    expect(code).toBe(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('valid-one'));
    expect(error).toHaveBeenCalledWith(expect.stringContaining('corrupt-one'));
  });
});

describe('runMatchForwardInspectCommand', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exits 1 with usage when matchId is missing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const code = await runMatchForwardInspectCommand([], { rootDir: repoRoot });
    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });

  it('exits 1 for a matchId with no saved record', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const code = await runMatchForwardInspectCommand(['never-saved', '--store-dir', dbPath], {
      rootDir: repoRoot,
    });
    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('No forward match record found'));
  });

  it('prints details for an existing record', async () => {
    await saveForwardMatchRecord(dbPath, sampleRecord({ matchId: 'inspectable', roundsPlayed: 3 }));

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const code = await runMatchForwardInspectCommand(['inspectable', '--store-dir', dbPath], {
      rootDir: repoRoot,
    });
    expect(code).toBe(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Forward match inspectable'));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('rounds played: 3'));
  });
});

describe('runMatchForwardEndCommand', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exits 1 with usage when matchId is missing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const code = await runMatchForwardEndCommand([], { rootDir: repoRoot });
    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });

  it('exits 1 for a matchId with no saved record', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const code = await runMatchForwardEndCommand(['never-saved', '--store-dir', dbPath], {
      rootDir: repoRoot,
    });
    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('No forward match record found'));
  });

  it('ends an active match, persisting status "ended" and bumping updatedAt', async () => {
    await saveForwardMatchRecord(
      dbPath,
      sampleRecord({ matchId: 'endable', roundsPlayed: 5, updatedAt: '2026-09-10T00:00:00.000Z' }),
    );

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const code = await runMatchForwardEndCommand(['endable', '--store-dir', dbPath], {
      rootDir: repoRoot,
    });
    expect(code).toBe(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('ended at round 5'));

    const outcome = await loadForwardMatchRecord(dbPath, 'endable');
    if (outcome.status !== 'found') throw new Error(`expected "found", got "${outcome.status}"`);
    expect(outcome.record.status).toBe('ended');
    expect(outcome.record.updatedAt).not.toBe('2026-09-10T00:00:00.000Z');
  });

  it('is a no-op for a match that is already non-active, rather than an error', async () => {
    await saveForwardMatchRecord(
      dbPath,
      sampleRecord({ matchId: 'already-completed', status: 'completed' }),
    );

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const code = await runMatchForwardEndCommand(['already-completed', '--store-dir', dbPath], {
      rootDir: repoRoot,
    });
    expect(code).toBe(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('already completed'));

    const outcome = await loadForwardMatchRecord(dbPath, 'already-completed');
    if (outcome.status !== 'found') throw new Error(`expected "found", got "${outcome.status}"`);
    expect(outcome.record.status).toBe('completed');
  });
});
