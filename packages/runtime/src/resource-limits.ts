/**
 * Resource limits are game/tournament configuration, not engine constants (see
 * docs/architecture.md §7) — this is just the shape and a sensible fallback. They are
 * fairness/containment, not the timeout mechanism: a throttled bot could otherwise run
 * "forever" within its CPU share, which is why timeouts are enforced separately (lifecycle.ts).
 */
export interface ResourceLimits {
  cpus: number;
  memoryBytes: number;
  pidsLimit: number;
  tmpfsBytes: number;
}

export const DEFAULT_RESOURCE_LIMITS: ResourceLimits = {
  cpus: 1,
  memoryBytes: 256 * 1024 * 1024,
  pidsLimit: 64,
  tmpfsBytes: 32 * 1024 * 1024,
};
