import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Docker from 'dockerode';
import { describe, expect, it, vi } from 'vitest';
import { runMatchCommand } from '../src/commands/match.js';

/**
 * The one place the full registry -> on-demand image build -> real Docker match path gets
 * automated coverage, run against the actual repo (not a fixture) — the same bots and games a
 * real `yarn quant-fusion match run` invocation would resolve. Skipped entirely at collection
 * time when no Docker daemon is reachable, matching packages/runtime's integration test
 * convention.
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

async function checkDockerAvailable(): Promise<boolean> {
  try {
    await new Docker().ping();
    return true;
  } catch {
    return false;
  }
}

const dockerAvailable = await checkDockerAvailable();

describe.runIf(dockerAvailable)('runMatchCommand (real Docker, real registry)', () => {
  it('exits 1 for an unknown bot id', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const code = await runMatchCommand(['quant-v0', 'not-a-real-bot'], { rootDir: repoRoot });

    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Unknown bot id'));

    error.mockRestore();
    log.mockRestore();
  });
});
