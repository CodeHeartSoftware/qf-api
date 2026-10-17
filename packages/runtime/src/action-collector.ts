// The runtime <-> engine seam (docs/guides/tournament-author-guide.md §5, item 2): a real
// ActionCollector (@quant-fusion/engine) backed by real BotLifecycle instances, so runMatch() can
// drive actual Docker containers instead of a test's scripted collector. This is the same shape
// an earlier ad hoc scrimmage script proved out by hand; this is that adapter, promoted and
// tested for real.
import type { ActionCollector, CollectedAction, RequestActionArgs } from '@quant-fusion/engine';
import type { ForfeitReason } from '@quant-fusion/protocol';
import type { MissingActionReason } from '@quant-fusion/engine';
import type { BotLifecycle } from './lifecycle.js';

const TIMEOUT_REASONS: ForfeitReason[] = ['TURN_TIMEOUT', 'INIT_TIMEOUT', 'MATCH_TIMEOUT'];
const INVALID_REASONS: ForfeitReason[] = [
  'PROTOCOL_VIOLATION',
  'ILLEGAL_ACTION',
  'PROTOCOL_VERSION_UNSUPPORTED',
];

/** Collapses BotLifecycle's rich ForfeitReason down to the engine's generic collection outcome. */
function mapForfeitReason(forfeitReason: ForfeitReason): MissingActionReason {
  if (TIMEOUT_REASONS.includes(forfeitReason)) {
    return 'timeout';
  }
  if (INVALID_REASONS.includes(forfeitReason)) {
    return 'invalid';
  }
  return 'disconnected'; // BOT_CRASHED, RESOURCE_LIMIT_EXCEEDED, ENGINE_ERROR, RESIGNED
}

export class DockerActionCollector implements ActionCollector {
  constructor(private readonly lifecycles: ReadonlyMap<string, BotLifecycle>) {}

  async requestAction(args: RequestActionArgs): Promise<CollectedAction> {
    const lifecycle = this.lifecycles.get(args.participantId);
    if (!lifecycle) {
      throw new Error(`no BotLifecycle registered for participant "${args.participantId}"`);
    }

    lifecycle.sendObservation(args.roundId, {
      state: args.observation,
      awaitingAction: args.required,
    });
    if (!args.required) {
      return { ok: false, reason: 'timeout' };
    }

    const outcome = await lifecycle.awaitAction(args.roundId, args.deadlineMs);
    return outcome.ok
      ? { ok: true, action: outcome.action }
      : { ok: false, reason: mapForfeitReason(outcome.forfeitReason) };
  }
}
