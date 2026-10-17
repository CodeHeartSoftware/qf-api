import { createRng } from '@quant-fusion/rng';
import { describe, expect, it, vi } from 'vitest';
import {
  runAvailableRounds,
  runMatch,
  type ActionCollector,
  type CollectedAction,
  type RequestActionArgs,
} from '../src/match-runner.js';
import { err, ok, type GameDefinition } from '../src/types.js';

const rng = createRng(Buffer.alloc(16, 42));

/** Records every call and lets the test resolve each request whenever it chooses to. */
class DeferredCollector implements ActionCollector {
  readonly calls: RequestActionArgs[] = [];
  private readonly pending = new Map<string, (collected: CollectedAction) => void>();

  requestAction(args: RequestActionArgs): Promise<CollectedAction> {
    this.calls.push(args);
    return new Promise((resolve) => {
      this.pending.set(`${String(args.roundId)}:${args.participantId}`, resolve);
    });
  }

  settle(roundId: number, participantId: string, collected: CollectedAction): void {
    const key = `${String(roundId)}:${participantId}`;
    const resolve = this.pending.get(key);
    if (!resolve) {
      throw new Error(`no pending request for ${key}`);
    }
    this.pending.delete(key);
    resolve(collected);
  }
}

/** Resolves every request instantly according to a per-call script. */
class ScriptedCollector implements ActionCollector {
  readonly calls: RequestActionArgs[] = [];
  constructor(private readonly script: (args: RequestActionArgs) => CollectedAction) {}

  requestAction(args: RequestActionArgs): Promise<CollectedAction> {
    this.calls.push(args);
    return Promise.resolve(this.script(args));
  }
}

// ---------------------------------------------------------------------------
// Synthetic game 1: sequential single-actor "race to N"
// ---------------------------------------------------------------------------

interface RaceState {
  scores: Map<string, number>;
  order: string[];
  turn: number;
}
interface RaceAction {
  increment: number;
}
interface RaceResult {
  winner: string;
}

function isRaceAction(raw: unknown): raw is RaceAction {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    'increment' in raw &&
    typeof raw.increment === 'number'
  );
}

function currentRacer(state: RaceState): string {
  const id = state.order[state.turn % state.order.length];
  if (id === undefined) {
    throw new Error('unreachable: order is non-empty by construction');
  }
  return id;
}

function makeRaceGame(
  target: number,
): GameDefinition<undefined, RaceState, RaceState, RaceAction, RaceResult> {
  return {
    id: 'test-race',
    version: '1.0.0',
    parseConfig: () => ok(undefined),
    initialize: ({ participantIds }) => ({
      scores: new Map(participantIds.map((id) => [id, 0])),
      order: participantIds,
      turn: 0,
    }),
    getObservation: (state) => state,
    getPendingActions: (state) => [{ participantId: currentRacer(state), required: true }],
    validateAction: (_state, _participantId, raw) =>
      isRaceAction(raw) ? ok(raw) : err('expected { increment: number }'),
    resolve: ({ state, actions }) => {
      const activeId = currentRacer(state);
      const increment = actions.get(activeId)?.increment ?? 0;
      const nextScores = new Map(state.scores);
      nextScores.set(activeId, (nextScores.get(activeId) ?? 0) + increment);
      return {
        nextState: { scores: nextScores, order: state.order, turn: state.turn + 1 },
        events: [{ type: 'increment', participantIds: [activeId], data: { increment } }],
      };
    },
    isTerminal: (state) => [...state.scores.values()].some((score) => score >= target),
    getResult: (state) => {
      const first = state.order[0];
      if (first === undefined) {
        throw new Error('unreachable: order is non-empty by construction');
      }
      let winner = first;
      let best = state.scores.get(winner) ?? 0;
      for (const id of state.order) {
        const score = state.scores.get(id) ?? 0;
        if (score > best) {
          winner = id;
          best = score;
        }
      }
      return { winner };
    },
    getStandingOutcomes: (result) => [{ participantId: result.winner, rank: 1, outcome: 'win' }],
    resourceLimits: {},
  };
}

describe('runMatch: sequential single-actor game', () => {
  it('drives multiple rounds and produces the game-decided winner', async () => {
    const collector = new ScriptedCollector(() => ({ ok: true, action: { increment: 2 } }));
    const outcome = await runMatch({
      game: makeRaceGame(4),
      config: undefined,
      participantIds: ['p1', 'p2'],
      rng,
      collector,
      defaultDeadlineMs: 1000,
      matchDeadlineMs: 60_000,
    });

    expect(outcome.status).toBe('completed');
    expect(outcome.result).toEqual({ winner: 'p1' }); // p1 goes first, reaches 4 first
    expect(outcome.standingOutcomes).toEqual([{ participantId: 'p1', rank: 1, outcome: 'win' }]);
    expect(outcome.events.length).toBeGreaterThan(1);
    // Only the active participant is ever asked, never both.
    expect(collector.calls.every((c) => c.required)).toBe(true);
  });

  it('calls onRoundResolved once per resolved round, with that round’s own events', async () => {
    const collector = new ScriptedCollector(() => ({ ok: true, action: { increment: 2 } }));
    const resolvedRounds: unknown[][] = [];
    const outcome = await runMatch({
      game: makeRaceGame(4),
      config: undefined,
      participantIds: ['p1', 'p2'],
      rng,
      collector,
      defaultDeadlineMs: 1000,
      matchDeadlineMs: 60_000,
      onRoundResolved: (events) => resolvedRounds.push(events),
    });

    expect(resolvedRounds).toEqual(outcome.events);
  });

  it('never calls onRoundResolved for a round that ends in forfeit', async () => {
    const collector = new ScriptedCollector(() => ({ ok: false, reason: 'timeout' }));
    const onRoundResolved = vi.fn();
    const outcome = await runMatch({
      game: makeRaceGame(4),
      config: undefined,
      participantIds: ['p1', 'p2'],
      rng,
      collector,
      defaultDeadlineMs: 1000,
      matchDeadlineMs: 60_000,
      onRoundResolved,
    });

    expect(outcome.status).toBe('forfeit');
    expect(onRoundResolved).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Synthetic game 2: simultaneous 2-player "number duel"
// ---------------------------------------------------------------------------

interface DuelState {
  roundWins: Map<string, number>;
  targetWins: number;
}
type DuelAction = number;
interface DuelResult {
  winner: string;
}

function makeDuelGame(
  participantIds: readonly string[],
  onMissingAction?: GameDefinition<
    undefined,
    DuelState,
    DuelState,
    DuelAction,
    DuelResult
  >['onMissingAction'],
): GameDefinition<undefined, DuelState, DuelState, DuelAction, DuelResult> {
  return {
    id: 'test-duel',
    version: '1.0.0',
    parseConfig: () => ok(undefined),
    initialize: () => ({ roundWins: new Map(participantIds.map((id) => [id, 0])), targetWins: 2 }),
    getObservation: (state) => state,
    getPendingActions: () =>
      participantIds.map((participantId) => ({ participantId, required: true })),
    validateAction: (_state, _participantId, raw) =>
      typeof raw === 'number' ? ok(raw) : err('expected a number'),
    resolve: ({ state, actions }) => {
      let leader: string | undefined;
      let leaderValue = -Infinity;
      for (const [participantId, value] of actions) {
        if (value > leaderValue) {
          leader = participantId;
          leaderValue = value;
        }
      }
      const nextWins = new Map(state.roundWins);
      if (leader !== undefined) {
        nextWins.set(leader, (nextWins.get(leader) ?? 0) + 1);
      }
      return {
        nextState: { roundWins: nextWins, targetWins: state.targetWins },
        events: [{ type: 'round-result', data: { leader } }],
      };
    },
    isTerminal: (state) => [...state.roundWins.values()].some((wins) => wins >= state.targetWins),
    getResult: (state) => {
      const first = participantIds[0];
      if (first === undefined) {
        throw new Error('unreachable: participantIds is non-empty by construction');
      }
      let winner = first;
      let best = state.roundWins.get(winner) ?? 0;
      for (const id of participantIds) {
        const wins = state.roundWins.get(id) ?? 0;
        if (wins > best) {
          winner = id;
          best = wins;
        }
      }
      return { winner };
    },
    getStandingOutcomes: (result) => [{ participantId: result.winner, rank: 1, outcome: 'win' }],
    ...(onMissingAction ? { onMissingAction } : {}),
    resourceLimits: {},
  };
}

describe('runMatch: simultaneous game', () => {
  it('requests every required participant concurrently within a round', async () => {
    const collector = new DeferredCollector();
    const promise = runMatch({
      game: makeDuelGame(['p1', 'p2']),
      config: undefined,
      participantIds: ['p1', 'p2'],
      rng,
      collector,
      defaultDeadlineMs: 1000,
      matchDeadlineMs: 60_000,
    });

    // Both requests must already be outstanding — nothing has been resolved yet.
    expect(collector.calls.map((c) => c.participantId).sort()).toEqual(['p1', 'p2']);

    collector.settle(0, 'p1', { ok: true, action: 5 });
    collector.settle(0, 'p2', { ok: true, action: 3 });
    // Let the round-0 resolution and the loop's next iteration fully flush before round 1's
    // requests exist to be settled.
    await new Promise((resolve) => setImmediate(resolve));
    collector.settle(1, 'p1', { ok: true, action: 5 });
    collector.settle(1, 'p2', { ok: true, action: 3 });

    const outcome = await promise;
    expect(outcome.status).toBe('completed');
    expect(outcome.result).toEqual({ winner: 'p1' });
  });

  it('defaults to forfeiting the match when a required action never arrives', async () => {
    const collector = new ScriptedCollector((args) =>
      args.participantId === 'p2' ? { ok: false, reason: 'timeout' } : { ok: true, action: 5 },
    );
    const outcome = await runMatch({
      game: makeDuelGame(['p1', 'p2']), // no onMissingAction -> engine default applies
      config: undefined,
      participantIds: ['p1', 'p2'],
      rng,
      collector,
      defaultDeadlineMs: 1000,
      matchDeadlineMs: 60_000,
    });

    expect(outcome.status).toBe('forfeit');
    expect(outcome.forfeitedParticipantIds).toEqual(['p2']);
    expect(outcome.standingOutcomes).toEqual([
      { participantId: 'p1', rank: 1, outcome: 'win' },
      { participantId: 'p2', rank: 2, outcome: 'loss' },
    ]);
  });

  it('honors a game-defined leniency policy instead of forfeiting', async () => {
    const collector = new ScriptedCollector((args) =>
      args.roundId === 0 && args.participantId === 'p2'
        ? { ok: false, reason: 'timeout' }
        : { ok: true, action: 5 },
    );
    const outcome = await runMatch({
      game: makeDuelGame(['p1', 'p2'], () => ({ policy: 'substitute', action: 0 })),
      config: undefined,
      participantIds: ['p1', 'p2'],
      rng,
      collector,
      defaultDeadlineMs: 1000,
      matchDeadlineMs: 60_000,
    });

    expect(outcome.status).toBe('completed');
    expect(outcome.result).toEqual({ winner: 'p1' });
  });

  it('treats a structurally-invalid action as the "invalid" missing-action reason', async () => {
    let sawInvalidReason = false;
    const collector = new ScriptedCollector((args) =>
      args.participantId === 'p2' ? { ok: true, action: 'not-a-number' } : { ok: true, action: 5 },
    );
    const game = makeDuelGame(['p1', 'p2'], ({ reason }) => {
      sawInvalidReason = reason === 'invalid';
      return { policy: 'forfeit-match' };
    });

    const outcome = await runMatch({
      game,
      config: undefined,
      participantIds: ['p1', 'p2'],
      rng,
      collector,
      defaultDeadlineMs: 1000,
      matchDeadlineMs: 60_000,
    });

    expect(sawInvalidReason).toBe(true);
    expect(outcome.status).toBe('forfeit');
    expect(outcome.forfeitedParticipantIds).toEqual(['p2']);
  });
});

// ---------------------------------------------------------------------------
// Synthetic game 3: one required + one optional participant
// ---------------------------------------------------------------------------

interface ReactiveState {
  protested: boolean;
  round: number;
}

function makeOptionalParticipantGame(): GameDefinition<
  undefined,
  ReactiveState,
  ReactiveState,
  { protest?: boolean } | { move: true },
  { protested: boolean }
> {
  return {
    id: 'test-optional',
    version: '1.0.0',
    parseConfig: () => ok(undefined),
    initialize: () => ({ protested: false, round: 0 }),
    getObservation: (state) => state,
    getPendingActions: () => [
      { participantId: 'mover', required: true },
      { participantId: 'observer', required: false },
    ],
    validateAction: (_state, participantId, raw) => {
      if (participantId === 'mover') {
        return ok({ move: true as const });
      }
      if (typeof raw === 'object' && raw !== null && 'protest' in raw) {
        return ok(raw as { protest?: boolean });
      }
      return err('expected an optional protest action');
    },
    resolve: ({ state, actions }) => {
      const observerAction = actions.get('observer');
      const protested =
        observerAction !== undefined && 'protest' in observerAction && observerAction.protest;
      return {
        nextState: { protested: state.protested || protested, round: state.round + 1 },
        events: [],
      };
    },
    isTerminal: (state) => state.round >= 1,
    getResult: (state) => ({ protested: state.protested }),
    getStandingOutcomes: () => [{ participantId: 'mover', rank: 1 }],
    resourceLimits: {},
  };
}

describe('runMatch: optional participant', () => {
  it('includes a voluntary, valid optional action in resolve()', async () => {
    const collector = new ScriptedCollector((args) =>
      args.participantId === 'observer'
        ? { ok: true, action: { protest: true } }
        : { ok: true, action: { move: true } },
    );
    const outcome = await runMatch({
      game: makeOptionalParticipantGame(),
      config: undefined,
      participantIds: ['mover', 'observer'],
      rng,
      collector,
      defaultDeadlineMs: 1000,
      matchDeadlineMs: 60_000,
    });
    expect(outcome.result).toEqual({ protested: true });
  });

  it('proceeds normally when the optional participant never responds', async () => {
    const collector = new ScriptedCollector((args) =>
      args.participantId === 'observer'
        ? { ok: false, reason: 'timeout' }
        : { ok: true, action: { move: true } },
    );
    const outcome = await runMatch({
      game: makeOptionalParticipantGame(),
      config: undefined,
      participantIds: ['mover', 'observer'],
      rng,
      collector,
      defaultDeadlineMs: 1000,
      matchDeadlineMs: 60_000,
    });
    expect(outcome.status).toBe('completed');
    expect(outcome.result).toEqual({ protested: false });
  });

  it('silently ignores an invalid voluntary submission rather than forfeiting', async () => {
    const collector = new ScriptedCollector((args) =>
      args.participantId === 'observer'
        ? { ok: true, action: 'garbage' }
        : { ok: true, action: { move: true } },
    );
    const outcome = await runMatch({
      game: makeOptionalParticipantGame(),
      config: undefined,
      participantIds: ['mover', 'observer'],
      rng,
      collector,
      defaultDeadlineMs: 1000,
      matchDeadlineMs: 60_000,
    });
    expect(outcome.status).toBe('completed');
    expect(outcome.result).toEqual({ protested: false });
  });
});

// ---------------------------------------------------------------------------
// Synthetic game 4: N (3) players — proves no engine-level assumption of exactly 2
// ---------------------------------------------------------------------------

function makeThreePlayerGame(
  participantIds: readonly string[],
): GameDefinition<
  undefined,
  { done: boolean },
  { done: boolean },
  boolean,
  { participated: string[] }
> {
  return {
    id: 'test-three-player',
    version: '1.0.0',
    parseConfig: () => ok(undefined),
    initialize: () => ({ done: false }),
    getObservation: (state) => state,
    getPendingActions: () =>
      participantIds.map((participantId) => ({ participantId, required: true })),
    validateAction: (_state, _participantId, raw) =>
      typeof raw === 'boolean' ? ok(raw) : err('expected boolean'),
    resolve: ({ actions }) => ({
      nextState: { done: true },
      events: [{ type: 'all-acted', participantIds: [...actions.keys()] }],
    }),
    isTerminal: (state) => state.done,
    getResult: () => ({ participated: [...participantIds] }),
    getStandingOutcomes: (result) =>
      result.participated.map((participantId) => ({ participantId, rank: 1 })),
    resourceLimits: {},
  };
}

describe('runMatch: N-player generality', () => {
  it('supports 3 required participants in a single round', async () => {
    const collector = new ScriptedCollector(() => ({ ok: true, action: true }));
    const outcome = await runMatch({
      game: makeThreePlayerGame(['p1', 'p2', 'p3']),
      config: undefined,
      participantIds: ['p1', 'p2', 'p3'],
      rng,
      collector,
      defaultDeadlineMs: 1000,
      matchDeadlineMs: 60_000,
    });
    expect(outcome.status).toBe('completed');
    expect(collector.calls).toHaveLength(3);
    expect(outcome.standingOutcomes).toHaveLength(3);
  });

  it('does not label survivors "win" when more than 2 participants remain ambiguous', async () => {
    const collector = new ScriptedCollector((args) =>
      args.participantId === 'p3'
        ? { ok: false, reason: 'disconnected' }
        : { ok: true, action: true },
    );
    const outcome = await runMatch({
      game: makeThreePlayerGame(['p1', 'p2', 'p3']),
      config: undefined,
      participantIds: ['p1', 'p2', 'p3'],
      rng,
      collector,
      defaultDeadlineMs: 1000,
      matchDeadlineMs: 60_000,
    });
    expect(outcome.status).toBe('forfeit');
    expect(outcome.standingOutcomes).toEqual([
      { participantId: 'p1', rank: 1 },
      { participantId: 'p2', rank: 1 },
      { participantId: 'p3', rank: 2, outcome: 'loss' },
    ]);
  });
});

describe('runMatch: match-timeout (whole-match wall-clock safety net)', () => {
  // docs/adr/0003-docker-bot-isolation.md calls for this: every participant can respond
  // correctly, on time, every round, and the match can still never terminate — e.g. two real
  // bots (copycat-rps vs a bot that always plays the same throw) whose strategies converge into
  // an infinite draw cycle. No single participant is at fault, so this must be distinct from a
  // forfeit.
  it('returns "match-timeout" with an all-draw standing when isTerminal never becomes true', async () => {
    // increment: 0 means the race's target score is never reached — isTerminal() never fires.
    const collector = new ScriptedCollector(() => ({ ok: true, action: { increment: 0 } }));
    let elapsedMs = 0;
    const now = () => {
      elapsedMs += 10;
      return elapsedMs;
    };

    const outcome = await runMatch({
      game: makeRaceGame(4),
      config: undefined,
      participantIds: ['p1', 'p2'],
      rng,
      collector,
      defaultDeadlineMs: 1000,
      matchDeadlineMs: 100,
      now,
    });

    expect(outcome.status).toBe('match-timeout');
    expect(outcome.forfeitedParticipantIds).toBeUndefined();
    expect(outcome.standingOutcomes).toEqual([
      { participantId: 'p1', rank: 1, outcome: 'draw' },
      { participantId: 'p2', rank: 1, outcome: 'draw' },
    ]);
  });

  it('never times out a match that completes well within the deadline', async () => {
    const collector = new ScriptedCollector(() => ({ ok: true, action: { increment: 4 } }));

    const outcome = await runMatch({
      game: makeRaceGame(4),
      config: undefined,
      participantIds: ['p1', 'p2'],
      rng,
      collector,
      defaultDeadlineMs: 1000,
      matchDeadlineMs: 60_000,
    });

    expect(outcome.status).toBe('completed');
  });
});

// ---------------------------------------------------------------------------
// runAvailableRounds — the resumable-caller primitive `runMatch` is now a thin wrapper over
// (roadmap Phase 3, docs/adr/0013-forward-match-persistence.md). These tests exercise exactly the
// capabilities `runMatch` itself can't offer: starting from an already-in-progress state, and
// observing `finalState` on every stopping condition (not just success).
// ---------------------------------------------------------------------------

describe('runAvailableRounds', () => {
  it('drives an already-in-progress state to completion, not from scratch', async () => {
    // Single-participant race, so there's no turn-alternation to reason about — the state after
    // one manually-applied round is unambiguously "one round from the target."
    const game = makeRaceGame(4);
    const initial = game.initialize({ config: undefined, participantIds: ['p1'], rng });
    // Simulates a resumed match: one round already resolved by SOME earlier call, outside this
    // one — p1 is already at 2, needs one more round of +2 to reach the target of 4.
    const resumedState = game.resolve({
      state: initial,
      actions: new Map([['p1', { increment: 2 }]]),
      rng,
    }).nextState;

    const collector = new ScriptedCollector(() => ({ ok: true, action: { increment: 2 } }));
    const outcome = await runAvailableRounds({
      game,
      state: resumedState,
      participantIds: ['p1'],
      rng,
      collector,
      defaultDeadlineMs: 1000,
      matchDeadlineMs: 60_000,
    });

    expect(outcome.terminalOutcome).toEqual({
      status: 'completed',
      result: { winner: 'p1' },
      standingOutcomes: [{ participantId: 'p1', rank: 1, outcome: 'win' }],
    });
    // Only the one remaining round is played/reported — the round already resolved before this
    // call isn't replayed into `events`.
    expect(outcome.events.length).toBe(1);
    expect(outcome.finalState.scores.get('p1')).toBe(4);
  });

  it('exposes finalState as of the last successfully resolved round on forfeit', async () => {
    const game = makeDuelGame(['p1', 'p2']);
    const state = game.initialize({ config: undefined, participantIds: ['p1', 'p2'], rng });
    const collector = new ScriptedCollector((args) =>
      args.roundId === 1 && args.participantId === 'p2'
        ? { ok: false, reason: 'timeout' }
        : { ok: true, action: 5 },
    );

    const outcome = await runAvailableRounds({
      game,
      state,
      participantIds: ['p1', 'p2'],
      rng,
      collector,
      defaultDeadlineMs: 1000,
      matchDeadlineMs: 60_000,
    });

    expect(outcome.terminalOutcome?.status).toBe('forfeit');
    // Round 0 resolved (p1 wins it, both submitted 5) before round 1's forfeit stopped the loop —
    // finalState must reflect that resolved round, not the pristine initial state.
    expect(outcome.finalState.roundWins.get('p1')).toBe(1);
  });

  it('exposes finalState on match-timeout, so a caller can persist progress and retry later', async () => {
    const game = makeRaceGame(4);
    const state = game.initialize({ config: undefined, participantIds: ['p1', 'p2'], rng });
    const collector = new ScriptedCollector(() => ({ ok: true, action: { increment: 0 } }));
    let elapsedMs = 0;
    const now = () => {
      elapsedMs += 10;
      return elapsedMs;
    };

    const outcome = await runAvailableRounds({
      game,
      state,
      participantIds: ['p1', 'p2'],
      rng,
      collector,
      defaultDeadlineMs: 1000,
      matchDeadlineMs: 100,
      now,
    });

    expect(outcome.terminalOutcome?.status).toBe('match-timeout');
    expect(outcome.finalState).toBeDefined();
  });

  it('honors startingRoundId, continuing round-id numbering rather than restarting at 0', async () => {
    const game = makeRaceGame(2);
    const state = game.initialize({ config: undefined, participantIds: ['p1'], rng });
    const collector = new ScriptedCollector(() => ({ ok: true, action: { increment: 2 } }));

    await runAvailableRounds({
      game,
      state,
      participantIds: ['p1'],
      rng,
      collector,
      defaultDeadlineMs: 1000,
      matchDeadlineMs: 60_000,
      startingRoundId: 7,
    });

    expect(collector.calls[0]?.roundId).toBe(7);
  });

  it("awaits onRoundResolved before requesting the next round's actions", async () => {
    const game = makeRaceGame(4);
    const state = game.initialize({ config: undefined, participantIds: ['p1'], rng });
    const order: string[] = [];
    const collector = new ScriptedCollector((args) => {
      order.push(`request:${String(args.roundId)}`);
      return { ok: true, action: { increment: 2 } };
    });

    await runAvailableRounds({
      game,
      state,
      participantIds: ['p1'],
      rng,
      collector,
      defaultDeadlineMs: 1000,
      matchDeadlineMs: 60_000,
      onRoundResolved: async () => {
        await Promise.resolve(); // force a genuine async hop, not a same-tick no-op
        order.push('hook-done');
      },
    });

    // Two rounds needed to reach the target (+2 each); if the hook weren't awaited, round 1
    // would be requested before round 0's hook finished — this order proves it is, for both
    // rounds (the second hook-done, for round 1, fires after the match is already terminal).
    expect(order).toEqual(['request:0', 'hook-done', 'request:1', 'hook-done']);
  });

  it('propagates a rejecting onRoundResolved rather than silently playing further unpersisted rounds', async () => {
    const game = makeRaceGame(4);
    const state = game.initialize({ config: undefined, participantIds: ['p1'], rng });
    const collector = new ScriptedCollector(() => ({ ok: true, action: { increment: 2 } }));

    await expect(
      runAvailableRounds({
        game,
        state,
        participantIds: ['p1'],
        rng,
        collector,
        defaultDeadlineMs: 1000,
        matchDeadlineMs: 60_000,
        onRoundResolved: () => {
          throw new Error('persist failed');
        },
      }),
    ).rejects.toThrow('persist failed');
    expect(collector.calls.length).toBe(1);
  });
});
