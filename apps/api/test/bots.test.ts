import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listBots } from '../src/routes/bots.js';

let rootDir: string;

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), 'sm4-api-bots-'));
});

afterEach(() => {
  rmSync(rootDir, { recursive: true, force: true });
});

function writeBot(id: string, manifest: Record<string, unknown> | undefined): void {
  const dir = join(rootDir, 'bots', 'stock-market-4', id);
  mkdirSync(dir, { recursive: true });
  if (manifest !== undefined) {
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
  }
}

describe('listBots', () => {
  it('returns an empty list when the bots directory does not exist', async () => {
    expect(await listBots(rootDir)).toEqual([]);
  });

  it('reads every bot manifest, sorted by directory name', async () => {
    writeBot('zeta-bot', {
      id: 'zeta-bot',
      name: 'Zeta',
      version: '0.1.0',
      game: 'stock-market-4',
    });
    writeBot('alpha-bot', {
      id: 'alpha-bot',
      name: 'Alpha',
      version: '0.2.0',
      game: 'stock-market-4',
      description: 'first',
    });

    const bots = await listBots(rootDir);
    expect(bots).toEqual([
      {
        id: 'alpha-bot',
        name: 'Alpha',
        version: '0.2.0',
        game: 'stock-market-4',
        description: 'first',
      },
      { id: 'zeta-bot', name: 'Zeta', version: '0.1.0', game: 'stock-market-4', description: '' },
    ]);
  });

  it('skips a directory with no manifest.json and one with an unparseable manifest', async () => {
    writeBot('no-manifest', undefined);
    const brokenDir = join(rootDir, 'bots', 'stock-market-4', 'broken');
    mkdirSync(brokenDir, { recursive: true });
    writeFileSync(join(brokenDir, 'manifest.json'), 'not json');
    writeBot('good', { id: 'good', name: 'Good', version: '1.0.0', game: 'stock-market-4' });

    expect(await listBots(rootDir)).toEqual([
      { id: 'good', name: 'Good', version: '1.0.0', game: 'stock-market-4', description: '' },
    ]);
  });
});
