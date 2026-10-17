import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanBots, scanGames } from '../src/scan.js';

const validGameManifest = {
  id: 'rock-paper-scissors',
  name: 'Rock Paper Scissors',
  version: '1.0.0',
  entryPackage: '@quant-fusion/game-rock-paper-scissors',
  protocolVersion: '^1.0',
  minParticipants: 2,
  maxParticipants: 2,
  maintainers: [{ name: 'Jane Doe', contact: 'jane@example.com' }],
};

const validBotManifest = {
  id: 'random-rps',
  name: 'Random RPS',
  version: '1.0.0',
  game: 'rock-paper-scissors',
  author: { name: 'Jane Doe', contact: 'jane@example.com' },
  runtime: { language: 'node' as const },
  interface: { transport: 'stdio' as const },
  protocolVersion: '^1.0',
};

let root: string;

async function writeManifest(dir: string, manifest: unknown): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest), 'utf8');
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'quant-fusion-registry-test-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('scanGames', () => {
  it('finds a valid game and returns no issues', async () => {
    await writeManifest(path.join(root, 'games', 'rock-paper-scissors'), validGameManifest);

    const result = await scanGames(root);

    expect(result.issues).toEqual([]);
    expect(result.entries.get('rock-paper-scissors')?.manifest).toEqual(validGameManifest);
  });

  it('returns an empty registry when games/ does not exist', async () => {
    const result = await scanGames(root);

    expect(result.entries.size).toBe(0);
    expect(result.issues).toEqual([]);
  });

  it('collects an issue for a manifest that fails schema validation, without crashing the scan', async () => {
    await writeManifest(path.join(root, 'games', 'broken'), { id: 'broken' });
    await writeManifest(path.join(root, 'games', 'rock-paper-scissors'), validGameManifest);

    const result = await scanGames(root);

    expect(result.entries.get('rock-paper-scissors')).toBeDefined();
    expect(result.entries.has('broken')).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.path).toContain('broken');
  });

  it('collects an issue for malformed JSON', async () => {
    const dir = path.join(root, 'games', 'not-json');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'manifest.json'), '{ not valid json', 'utf8');

    const result = await scanGames(root);

    expect(result.entries.size).toBe(0);
    expect(result.issues).toEqual([
      { path: path.join(dir, 'manifest.json'), message: 'missing or unreadable manifest.json' },
    ]);
  });

  it('keeps the first entry and flags a duplicate id', async () => {
    await writeManifest(path.join(root, 'games', 'rps-a'), validGameManifest);
    await writeManifest(path.join(root, 'games', 'rps-b'), validGameManifest);

    const result = await scanGames(root);

    expect(result.entries.size).toBe(1);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.message).toContain('duplicate game id');
  });
});

describe('scanBots', () => {
  it('finds a valid bot grouped under its matching game directory', async () => {
    await writeManifest(
      path.join(root, 'bots', 'rock-paper-scissors', 'random-rps'),
      validBotManifest,
    );

    const result = await scanBots(root);

    expect(result.issues).toEqual([]);
    const entry = result.entries.get('random-rps');
    expect(entry?.manifest).toEqual({
      ...validBotManifest,
      build: { dockerfile: 'Dockerfile', context: '.' },
    });
    expect(entry?.dir).toBe(path.join(root, 'bots', 'rock-paper-scissors', 'random-rps'));
  });

  it('returns an empty registry when bots/ does not exist', async () => {
    const result = await scanBots(root);

    expect(result.entries.size).toBe(0);
    expect(result.issues).toEqual([]);
  });

  it('flags a bot manifest whose game field disagrees with its directory grouping', async () => {
    await writeManifest(path.join(root, 'bots', 'chess', 'random-rps'), validBotManifest);

    const result = await scanBots(root);

    expect(result.entries.size).toBe(0);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.message).toContain('does not match its directory grouping');
  });

  it('collects an issue for a manifest that fails schema validation', async () => {
    await writeManifest(path.join(root, 'bots', 'rock-paper-scissors', 'broken'), { id: 'broken' });

    const result = await scanBots(root);

    expect(result.entries.size).toBe(0);
    expect(result.issues).toHaveLength(1);
  });

  it('keeps the first entry and flags a duplicate bot id across different games', async () => {
    await writeManifest(
      path.join(root, 'bots', 'rock-paper-scissors', 'random-rps'),
      validBotManifest,
    );
    await writeManifest(path.join(root, 'bots', 'chess', 'random-rps'), {
      ...validBotManifest,
      game: 'chess',
    });

    const result = await scanBots(root);

    expect(result.entries.size).toBe(1);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.message).toContain('duplicate bot id');
  });
});
