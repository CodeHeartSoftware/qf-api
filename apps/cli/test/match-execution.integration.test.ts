import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Docker from 'dockerode';
import { listQuantFusionContainers, type QuantFusionContainerInfo } from '@quant-fusion/runtime';
import { describe, expect, it } from 'vitest';
import {
  buildBotImages,
  loadGame,
  resolveBotsAndGame,
  runSingleMatch,
} from '../src/lib/match-execution.js';

/**
 * Resource-cleanup guarantees for `runSingleMatch` (apps/cli/src/lib/match-execution.ts) — run
 * against the real repo and real Docker, matching this project's other integration tests.
 * Skipped entirely at collection time when no Docker daemon is reachable.
 *
 * Deliberately does not exercise `runCleanupCommand` here: it force-removes *every*
 * `quant-fusion.matchId`-labeled container on the daemon, and Vitest runs this package's
 * integration test files concurrently — calling it for real would risk ripping out a container
 * a sibling test file (match.integration.test.ts, tournament.integration.test.ts) is actively
 * mid-match with. `packages/runtime/test/cleanup.test.ts` covers its list/remove logic with a
 * mocked Docker client instead; the real end-to-end path was verified once by hand.
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

async function containersForMatch(matchId: string): Promise<QuantFusionContainerInfo[]> {
  const containers = await listQuantFusionContainers();
  return containers.filter((container) => container.matchId === matchId);
}

describe.runIf(dockerAvailable)('runSingleMatch resource cleanup (real Docker)', () => {
  it('leaves no containers behind when a later participant fails to start', async () => {
    const resolved = await resolveBotsAndGame(repoRoot, ['quant-v0', 'quant-lite']);
    if (!resolved.ok) {
      throw new Error(resolved.message);
    }
    const { entries, gameEntry } = resolved;
    const game = await loadGame(gameEntry);
    const realImageTags = await buildBotImages(entries);

    // quant-v0 gets its real, working image; quant-lite is pointed at an image that doesn't
    // exist, forcing its container's `start()` to throw (packages/runtime's
    // `DockerBotProcess.start()`) partway through the participant loop.
    const brokenImageTags = new Map(realImageTags);
    brokenImageTags.set('quant-lite', 'quant-fusion-does-not-exist:latest');

    const matchId = `cleanup-test-broken-image-${String(Math.floor(Math.random() * 1_000_000))}`;

    await expect(
      runSingleMatch({
        game,
        gameEntry,
        config: {},
        matchId,
        participantIds: ['quant-v0', 'quant-lite'],
        imageTagsByBotId: brokenImageTags,
        tournamentSeed: Buffer.alloc(16, 1),
      }),
    ).rejects.toThrow();

    expect(await containersForMatch(matchId)).toEqual([]);
  }, 30_000);
});
