import { describe, expect, it } from 'vitest';
import { buildContainerCreateOptions } from '../src/docker-config.js';
import { DEFAULT_RESOURCE_LIMITS } from '../src/resource-limits.js';

const baseSpec = {
  imageRef: 'quant-fusion/random-rps@sha256:abc123',
  matchId: 'match-001',
  participantId: 'p1',
  resourceLimits: DEFAULT_RESOURCE_LIMITS,
};

describe('buildContainerCreateOptions', () => {
  it('never sets a bind mount', () => {
    const options = buildContainerCreateOptions(baseSpec);
    expect(options.HostConfig?.Binds).toEqual([]);
  });

  it('disables networking entirely', () => {
    const options = buildContainerCreateOptions(baseSpec);
    expect(options.HostConfig?.NetworkMode).toBe('none');
  });

  it('disables swap by matching MemorySwap to Memory', () => {
    const options = buildContainerCreateOptions(baseSpec);
    expect(options.HostConfig?.Memory).toBe(DEFAULT_RESOURCE_LIMITS.memoryBytes);
    expect(options.HostConfig?.MemorySwap).toBe(DEFAULT_RESOURCE_LIMITS.memoryBytes);
  });

  it('converts cpus to NanoCpus', () => {
    const options = buildContainerCreateOptions({
      ...baseSpec,
      resourceLimits: { ...DEFAULT_RESOURCE_LIMITS, cpus: 2 },
    });
    expect(options.HostConfig?.NanoCpus).toBe(2_000_000_000);
  });

  it('sets a read-only root filesystem with a non-executable tmpfs scratch dir', () => {
    const options = buildContainerCreateOptions(baseSpec);
    expect(options.HostConfig?.ReadonlyRootfs).toBe(true);
    expect(options.HostConfig?.Tmpfs?.['/tmp']).toContain('noexec');
    expect(options.HostConfig?.Tmpfs?.['/tmp']).toContain('nosuid');
    expect(options.HostConfig?.Tmpfs?.['/tmp']).toContain(
      `size=${String(DEFAULT_RESOURCE_LIMITS.tmpfsBytes)}`,
    );
  });

  it('drops all capabilities and disables privilege escalation', () => {
    const options = buildContainerCreateOptions(baseSpec);
    expect(options.HostConfig?.CapDrop).toEqual(['ALL']);
    expect(options.HostConfig?.SecurityOpt).toEqual(['no-new-privileges']);
  });

  it('runs as a non-root user by default', () => {
    const options = buildContainerCreateOptions(baseSpec);
    expect(options.User).toBe('65534:65534');
  });

  it('honors an explicit uid/gid override', () => {
    const options = buildContainerCreateOptions({ ...baseSpec, uid: 1000, gid: 1000 });
    expect(options.User).toBe('1000:1000');
  });

  it('does not auto-remove the container (the runner inspects exit info first)', () => {
    const options = buildContainerCreateOptions(baseSpec);
    expect(options.HostConfig?.AutoRemove).toBe(false);
  });

  it('applies the pids limit and stamps identifying labels', () => {
    const options = buildContainerCreateOptions(baseSpec);
    expect(options.HostConfig?.PidsLimit).toBe(DEFAULT_RESOURCE_LIMITS.pidsLimit);
    expect(options.Labels).toEqual({
      'quant-fusion.matchId': 'match-001',
      'quant-fusion.participantId': 'p1',
    });
  });

  it('configures stdio for NDJSON exchange, not an interactive TTY', () => {
    const options = buildContainerCreateOptions(baseSpec);
    expect(options.Tty).toBe(false);
    expect(options.OpenStdin).toBe(true);
    expect(options.AttachStdin).toBe(true);
    expect(options.AttachStdout).toBe(true);
    expect(options.AttachStderr).toBe(true);
  });
});
