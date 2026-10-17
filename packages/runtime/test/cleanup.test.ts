import type Docker from 'dockerode';
import { describe, expect, it, vi } from 'vitest';
import {
  listQuantFusionContainers,
  listQuantFusionImages,
  removeQuantFusionContainers,
  removeQuantFusionImages,
} from '../src/cleanup.js';

describe('listQuantFusionContainers', () => {
  it('filters on the quant-fusion.matchId label and maps to a plain shape', async () => {
    const listContainers = vi.fn().mockResolvedValue([
      {
        Id: 'abc123',
        Labels: { 'quant-fusion.matchId': 'm1', 'quant-fusion.participantId': 'p1' },
        State: 'running',
      },
      {
        Id: 'def456',
        Labels: { 'quant-fusion.matchId': 'm2', 'quant-fusion.participantId': 'p2' },
        State: 'exited',
      },
    ]);
    const docker = { listContainers } as unknown as Docker;

    const result = await listQuantFusionContainers(docker);

    expect(listContainers).toHaveBeenCalledWith({
      all: true,
      filters: { label: ['quant-fusion.matchId'] },
    });
    expect(result).toEqual([
      { id: 'abc123', matchId: 'm1', participantId: 'p1', state: 'running' },
      { id: 'def456', matchId: 'm2', participantId: 'p2', state: 'exited' },
    ]);
  });

  it('falls back to "unknown" for a container missing an expected label', async () => {
    const listContainers = vi
      .fn()
      .mockResolvedValue([{ Id: 'abc123', Labels: {}, State: 'running' }]);
    const docker = { listContainers } as unknown as Docker;

    const result = await listQuantFusionContainers(docker);

    expect(result).toEqual([
      { id: 'abc123', matchId: 'unknown', participantId: 'unknown', state: 'running' },
    ]);
  });
});

describe('removeQuantFusionContainers', () => {
  it('force-removes every listed container', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const getContainer = vi.fn().mockReturnValue({ remove });
    const docker = { getContainer } as unknown as Docker;

    const outcome = await removeQuantFusionContainers(
      [
        { id: 'abc123', matchId: 'm1', participantId: 'p1', state: 'running' },
        { id: 'def456', matchId: 'm2', participantId: 'p2', state: 'exited' },
      ],
      docker,
    );

    expect(getContainer).toHaveBeenCalledWith('abc123');
    expect(getContainer).toHaveBeenCalledWith('def456');
    expect(remove).toHaveBeenCalledWith({ force: true, v: true });
    expect(remove).toHaveBeenCalledTimes(2);
    expect(outcome).toEqual({ removedCount: 2, failures: [] });
  });

  it('counts an already-gone container (a 404 from the daemon) as removed, not a failure', async () => {
    const notFound = Object.assign(new Error('no such container'), { statusCode: 404 });
    const remove = vi.fn().mockRejectedValue(notFound);
    const getContainer = vi.fn().mockReturnValue({ remove });
    const docker = { getContainer } as unknown as Docker;

    const outcome = await removeQuantFusionContainers(
      [{ id: 'abc123', matchId: 'm1', participantId: 'p1', state: 'running' }],
      docker,
    );

    expect(outcome).toEqual({ removedCount: 1, failures: [] });
  });

  it('reports a genuine removal failure instead of silently swallowing it', async () => {
    const remove = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('container is restarting'), { statusCode: 409 }));
    const getContainer = vi.fn().mockReturnValue({ remove });
    const docker = { getContainer } as unknown as Docker;

    const outcome = await removeQuantFusionContainers(
      [{ id: 'abc123', matchId: 'm1', participantId: 'p1', state: 'running' }],
      docker,
    );

    expect(outcome).toEqual({
      removedCount: 0,
      failures: [{ id: 'abc123', reason: 'container is restarting' }],
    });
  });
});

describe('listQuantFusionImages', () => {
  it('filters on the quant-fusion-bot- tag prefix and maps to a plain shape', async () => {
    const listImages = vi.fn().mockResolvedValue([
      { Id: 'sha256:abc123', RepoTags: ['quant-fusion-bot-tominator-t1:latest'] },
      {
        Id: 'sha256:def456',
        RepoTags: ['quant-fusion-bot-random-hearts:latest', 'some-other-tag:latest'],
      },
    ]);
    const docker = { listImages } as unknown as Docker;

    const result = await listQuantFusionImages(docker);

    expect(listImages).toHaveBeenCalledWith({
      filters: { reference: ['quant-fusion-bot-*'] },
    });
    expect(result).toEqual([
      { id: 'sha256:abc123', tags: ['quant-fusion-bot-tominator-t1:latest'] },
      { id: 'sha256:def456', tags: ['quant-fusion-bot-random-hearts:latest'] },
    ]);
  });

  it('falls back to an empty tags array for an image with no RepoTags', async () => {
    const listImages = vi.fn().mockResolvedValue([{ Id: 'sha256:abc123', RepoTags: null }]);
    const docker = { listImages } as unknown as Docker;

    const result = await listQuantFusionImages(docker);

    expect(result).toEqual([{ id: 'sha256:abc123', tags: [] }]);
  });
});

describe('removeQuantFusionImages', () => {
  it('force-removes every listed image', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const getImage = vi.fn().mockReturnValue({ remove });
    const docker = { getImage } as unknown as Docker;

    const outcome = await removeQuantFusionImages(
      [
        { id: 'sha256:abc123', tags: ['quant-fusion-bot-tominator-t1:latest'] },
        { id: 'sha256:def456', tags: ['quant-fusion-bot-random-hearts:latest'] },
      ],
      docker,
    );

    expect(getImage).toHaveBeenCalledWith('sha256:abc123');
    expect(getImage).toHaveBeenCalledWith('sha256:def456');
    expect(remove).toHaveBeenCalledWith({ force: true });
    expect(remove).toHaveBeenCalledTimes(2);
    expect(outcome).toEqual({ removedCount: 2, failures: [] });
  });

  it('counts an already-gone image (a 404 from the daemon) as removed, not a failure', async () => {
    const notFound = Object.assign(new Error('no such image'), { statusCode: 404 });
    const remove = vi.fn().mockRejectedValue(notFound);
    const getImage = vi.fn().mockReturnValue({ remove });
    const docker = { getImage } as unknown as Docker;

    const outcome = await removeQuantFusionImages([{ id: 'sha256:abc123', tags: [] }], docker);

    expect(outcome).toEqual({ removedCount: 1, failures: [] });
  });

  it('reports a genuine removal failure instead of silently swallowing it', async () => {
    const remove = vi.fn().mockRejectedValue(
      Object.assign(new Error('image is being used by a running container'), {
        statusCode: 409,
      }),
    );
    const getImage = vi.fn().mockReturnValue({ remove });
    const docker = { getImage } as unknown as Docker;

    const outcome = await removeQuantFusionImages([{ id: 'sha256:abc123', tags: [] }], docker);

    expect(outcome).toEqual({
      removedCount: 0,
      failures: [{ id: 'sha256:abc123', reason: 'image is being used by a running container' }],
    });
  });
});
