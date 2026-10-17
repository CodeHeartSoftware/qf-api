import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { saveForwardMatchRecord, type ForwardMatchRecord } from '@quant-fusion/forward-match-store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMatchForwardPreviewCommand } from '../src/commands/matchForwardPreview.js';

// See `@quant-fusion/market-data`'s `src/store/db.ts` for why `node:sqlite` is loaded this way.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: typeof DatabaseSyncType;
};

/**
 * Unit-level coverage against the REAL registry, same spirit as `matchForward.test.ts` — every
 * path here returns before ever touching Docker (bad input, a not-yet-existing record, an invalid
 * --config-file), matching that file's own "validation paths, no Docker" scope. The real
 * "actually asks a bot container for a decision twice" path is exercised by hand, not here.
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

let dbPath: string;
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'quant-fusion-match-forward-preview-test-'));
  dbPath = join(root, 'db.sqlite');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const VALID_FORWARD_CONFIG = {
  gameType: 'FORWARD_SHADOW',
  marketDataUniverse: ['ELMT'],
  marketDataset: {
    id: 'quant-v0',
    version: '3',
    dbPath: './.quant-fusion/db.sqlite',
  },
  startDate: '2026-07-13',
  endDate: '2026-12-31',
};

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

describe('runMatchForwardPreviewCommand: validation paths (no Docker touched)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exits 1 with usage when matchId or --config-file is missing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await runMatchForwardPreviewCommand([], { rootDir: repoRoot })).toBe(1);
    expect(await runMatchForwardPreviewCommand(['some-match'], { rootDir: repoRoot })).toBe(1);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('Usage: quant-fusion match forward preview'),
    );
  });

  it('exits 1 when the match does not exist', async () => {
    const configPath = join(root, 'config.json');
    await writeFile(configPath, '{}', 'utf8');

    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const code = await runMatchForwardPreviewCommand(
      ['no-such-match', '--config-file', configPath, '--store-dir', dbPath],
      { rootDir: repoRoot },
    );
    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('No forward match record found'));
  });

  it('exits 1 when --config-file does not exist', async () => {
    const saved = await saveForwardMatchRecord(dbPath, sampleRecord());
    expect(saved.ok).toBe(true);

    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const code = await runMatchForwardPreviewCommand(
      ['test-forward-match', '--config-file', join(root, 'missing.json'), '--store-dir', dbPath],
      { rootDir: repoRoot },
    );
    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Could not read --config-file'));
  });

  it('exits 1 for invalid --config-file JSON', async () => {
    const saved = await saveForwardMatchRecord(dbPath, sampleRecord());
    expect(saved.ok).toBe(true);
    const configPath = join(root, 'config.json');
    await writeFile(configPath, 'not json{{', 'utf8');

    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const code = await runMatchForwardPreviewCommand(
      ['test-forward-match', '--config-file', configPath, '--store-dir', dbPath],
      { rootDir: repoRoot },
    );
    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('not valid JSON'));
  });

  it("exits 1 when --config-file fails the game's own schema", async () => {
    const saved = await saveForwardMatchRecord(
      dbPath,
      sampleRecord({ config: VALID_FORWARD_CONFIG }),
    );
    expect(saved.ok).toBe(true);
    const configPath = join(root, 'config.json');
    await writeFile(configPath, '{}', 'utf8');

    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const code = await runMatchForwardPreviewCommand(
      ['test-forward-match', '--config-file', configPath, '--store-dir', dbPath],
      { rootDir: repoRoot },
    );
    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Invalid --config-file'));
  });

  it('exits 1 when --participant matches none of the roster', async () => {
    const saved = await saveForwardMatchRecord(
      dbPath,
      sampleRecord({ participantIds: ['quant-v0', 'quant-lite'] }),
    );
    expect(saved.ok).toBe(true);

    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const code = await runMatchForwardPreviewCommand(
      [
        'test-forward-match',
        '--config-file',
        join(root, 'irrelevant.json'),
        '--store-dir',
        dbPath,
        '--participant',
        'not-in-this-match',
      ],
      { rootDir: repoRoot },
    );
    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('matched none of'));
  });

  it('exits 1 for a corrupt existing record', async () => {
    await saveForwardMatchRecord(dbPath, sampleRecord({ matchId: 'broken' }));
    const db = new DatabaseSync(dbPath);
    db.prepare("UPDATE forward_matches SET snapshot = 'not json{{{' WHERE match_id = ?").run(
      'broken',
    );
    db.close();
    const configPath = join(root, 'config.json');
    await writeFile(configPath, '{}', 'utf8');

    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const code = await runMatchForwardPreviewCommand(
      ['broken', '--config-file', configPath, '--store-dir', dbPath],
      { rootDir: repoRoot },
    );
    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('unparseable JSON'));
  });
});
