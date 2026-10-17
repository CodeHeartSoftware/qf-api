import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import Docker from 'dockerode';
import { describe, expect, it } from 'vitest';
import { BotLifecycle } from '../src/lifecycle.js';
import { DockerBotProcess } from '../src/docker-bot-process.js';
import { DEFAULT_RESOURCE_LIMITS } from '../src/resource-limits.js';

/**
 * Exercises the real Docker path end-to-end (docs/adr/0003-docker-bot-isolation.md) against the
 * minimal test bot fixture. Skipped entirely — at collection time, via top-level await — when no
 * Docker daemon is reachable, so this suite never fails a Docker-less CI run; it only runs (and
 * only builds the fixture image) when Docker is actually available.
 */
const execFileAsync = promisify(execFile);
const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'minimal-bot');
const IMAGE_TAG = 'quant-fusion-test-minimal-bot:latest';

async function checkDockerAvailable(): Promise<boolean> {
  try {
    await new Docker().ping();
    return true;
  } catch {
    return false;
  }
}

const dockerAvailable = await checkDockerAvailable();
if (dockerAvailable) {
  await execFileAsync('docker', ['build', '-t', IMAGE_TAG, fixtureDir]);
}

describe.runIf(dockerAvailable)('DockerBotProcess + BotLifecycle (real Docker)', () => {
  it('runs the minimal test bot through init, an action round-trip, and a clean match-end', async () => {
    const matchId = `integration-${String(Math.floor(Math.random() * 1_000_000))}`;
    const botProcess = new DockerBotProcess({
      imageRef: IMAGE_TAG,
      matchId,
      participantId: 'p1',
      resourceLimits: DEFAULT_RESOURCE_LIMITS,
    });
    await botProcess.start();

    const lifecycle = new BotLifecycle({ process: botProcess, matchId });

    const initOutcome = await lifecycle.initialize(
      {
        gameId: 'runtime-smoke-test',
        gameVersion: '0.0.0',
        participantId: 'p1',
        roster: ['p1'],
        rngSeed: 'deadbeef',
        config: {},
      },
      { initTimeoutMs: 10_000 },
    );
    expect(initOutcome).toEqual({ ok: true });
    expect(lifecycle.state).toBe('running');

    lifecycle.sendObservation(1, { state: { round: 1 }, awaitingAction: true });
    const actionOutcome = await lifecycle.awaitAction(1, 10_000);
    expect(actionOutcome).toEqual({ ok: true, action: { echo: { round: 1 } } });

    await lifecycle.finish({ result: { winner: 'p1' }, reason: 'completed' });
    expect(lifecycle.state).toBe('terminated');
    expect(lifecycle.getTerminalFailure()).toBeUndefined();
  }, 30_000);
});
