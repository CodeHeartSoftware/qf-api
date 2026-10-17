import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { computeBotSourceSha256 } from '../src/lib/botSourcePin.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'bot-pin-'));
  await mkdir(path.join(dir, 'src'));
  await mkdir(path.join(dir, 'backtest'));
  await writeFile(path.join(dir, 'src', 'index.ts'), 'export const x = 1;');
  await writeFile(path.join(dir, 'backtest', 'run.ts'), 'harness');
  await writeFile(path.join(dir, '.dockerignore'), 'backtest\n*.md\n');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('computeBotSourceSha256', () => {
  it('is stable for identical code and changes when a build input changes', async () => {
    const before = await computeBotSourceSha256(dir);
    expect(await computeBotSourceSha256(dir)).toBe(before);
    await writeFile(path.join(dir, 'src', 'index.ts'), 'export const x = 2;');
    expect(await computeBotSourceSha256(dir)).not.toBe(before);
  });

  it('ignores .dockerignored files and node_modules', async () => {
    const before = await computeBotSourceSha256(dir);
    await writeFile(path.join(dir, 'backtest', 'run.ts'), 'edited harness');
    await writeFile(path.join(dir, 'README.md'), 'notes');
    await mkdir(path.join(dir, 'node_modules'));
    await writeFile(path.join(dir, 'node_modules', 'x.js'), '1');
    expect(await computeBotSourceSha256(dir)).toBe(before);
  });
});
