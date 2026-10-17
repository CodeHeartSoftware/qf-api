import type Docker from 'dockerode';
import type { ResourceLimits } from './resource-limits.js';

/**
 * Pure builder for the container-create options behind ADR-0003's baseline hardening. Kept
 * side-effect-free (no Docker daemon involved) specifically so it's unit-testable on its own —
 * see test/docker-config.test.ts.
 */
export interface BotContainerSpec {
  /** Should be an immutable-digest reference in production (docs/adr/0004) — not enforced here. */
  imageRef: string;
  matchId: string;
  participantId: string;
  resourceLimits: ResourceLimits;
  uid?: number;
  gid?: number;
  nofileLimit?: number;
  stopTimeoutSeconds?: number;
}

export function buildContainerCreateOptions(spec: BotContainerSpec): Docker.ContainerCreateOptions {
  const uid = spec.uid ?? 65534;
  const gid = spec.gid ?? 65534;
  const nofileLimit = spec.nofileLimit ?? 64;
  const stopTimeoutSeconds = spec.stopTimeoutSeconds ?? 5;
  const { resourceLimits } = spec;

  return {
    Image: spec.imageRef,
    // NDJSON is line-oriented text over a pipe, not an interactive terminal session.
    OpenStdin: true,
    StdinOnce: false,
    Tty: false,
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    User: `${String(uid)}:${String(gid)}`,
    Labels: {
      'quant-fusion.matchId': spec.matchId,
      'quant-fusion.participantId': spec.participantId,
    },
    StopTimeout: stopTimeoutSeconds,
    HostConfig: {
      // No bind mounts, ever — the bot image is fully self-contained at build time, which is
      // what actually satisfies "no filesystem access to the repo or other bots" (there is no
      // shared filesystem to restrict access to).
      Binds: [],
      NetworkMode: 'none',
      Memory: resourceLimits.memoryBytes,
      // Swap disabled entirely (not just capped): no slow-degradation behavior, no timing side
      // channel from swap activity.
      MemorySwap: resourceLimits.memoryBytes,
      NanoCpus: Math.round(resourceLimits.cpus * 1e9),
      PidsLimit: resourceLimits.pidsLimit,
      ReadonlyRootfs: true,
      Tmpfs: {
        '/tmp': `rw,noexec,nosuid,size=${String(resourceLimits.tmpfsBytes)}`,
      },
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges'],
      // Docker's default seccomp profile applies automatically; it is intentionally not
      // disabled or replaced here. See ADR-0003's flagged gVisor/Firecracker follow-up for the
      // acknowledged gap between this and a hardened sandbox against a determined escape.
      Ulimits: [{ Name: 'nofile', Soft: nofileLimit, Hard: nofileLimit }],
      // The runner inspects exit info (OOMKilled, exit code) before removing the container
      // itself — AutoRemove would race that inspection.
      AutoRemove: false,
    },
  };
}
