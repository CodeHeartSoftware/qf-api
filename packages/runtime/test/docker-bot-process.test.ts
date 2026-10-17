import type Docker from 'dockerode';
import { describe, expect, it, vi } from 'vitest';
import { DockerBotProcess } from '../src/docker-bot-process.js';
import { DEFAULT_RESOURCE_LIMITS } from '../src/resource-limits.js';

/**
 * Unlike docker-bot-process.integration.test.ts (real Docker, the happy path and real protocol
 * traffic), this covers a failure path that's impractical to trigger reliably against a real
 * daemon: container creation succeeding but something *after* it — `attach()`/`start()` —
 * throwing. Without cleanup, that container would sit there forever, since `reportExit()` is
 * only ever wired up via `container.wait()`, which a throw here means `start()` never reaches.
 */
function fakeDocker(overrides: { attach?: () => Promise<never>; start?: () => Promise<void> }): {
  docker: Docker;
  remove: ReturnType<typeof vi.fn>;
} {
  const remove = vi.fn().mockResolvedValue(undefined);
  const container = {
    attach: overrides.attach ?? (() => Promise.resolve({})),
    start: overrides.start ?? (() => Promise.resolve()),
    remove,
    wait: () => Promise.resolve(),
    modem: { demuxStream: vi.fn() },
  };
  const createContainer = vi.fn().mockResolvedValue(container);
  return { docker: { createContainer } as unknown as Docker, remove };
}

describe('DockerBotProcess.start()', () => {
  it('removes the container if attach() throws after creation succeeds', async () => {
    const { docker, remove } = fakeDocker({
      attach: () => Promise.reject(new Error('attach failed')),
    });
    const botProcess = new DockerBotProcess(
      {
        imageRef: 'x',
        matchId: 'm1',
        participantId: 'p1',
        resourceLimits: DEFAULT_RESOURCE_LIMITS,
      },
      docker,
    );

    await expect(botProcess.start()).rejects.toThrow('attach failed');
    expect(remove).toHaveBeenCalledWith({ force: true });
  });

  it('removes the container if start() throws after creation and attach succeed', async () => {
    const { docker, remove } = fakeDocker({
      start: () => Promise.reject(new Error('start failed')),
    });
    const botProcess = new DockerBotProcess(
      {
        imageRef: 'x',
        matchId: 'm1',
        participantId: 'p1',
        resourceLimits: DEFAULT_RESOURCE_LIMITS,
      },
      docker,
    );

    await expect(botProcess.start()).rejects.toThrow('start failed');
    expect(remove).toHaveBeenCalledWith({ force: true });
  });

  it('does not attempt removal twice if the container itself is already gone', async () => {
    const remove = vi.fn().mockRejectedValue(new Error('no such container'));
    const container = {
      attach: () => Promise.reject(new Error('attach failed')),
      start: () => Promise.resolve(),
      remove,
      wait: () => Promise.resolve(),
      modem: { demuxStream: vi.fn() },
    };
    const createContainer = vi.fn().mockResolvedValue(container);
    const docker = { createContainer } as unknown as Docker;
    const botProcess = new DockerBotProcess(
      {
        imageRef: 'x',
        matchId: 'm1',
        participantId: 'p1',
        resourceLimits: DEFAULT_RESOURCE_LIMITS,
      },
      docker,
    );

    // The removal itself failing (e.g. the daemon already reaped it) must not mask the original
    // start() failure, nor throw an unhandled rejection.
    await expect(botProcess.start()).rejects.toThrow('attach failed');
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
