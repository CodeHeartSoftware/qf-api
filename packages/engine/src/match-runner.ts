import type {
  GameDefinition,
  MissingActionReason,
  RoundEvent,
  Rng,
  StandingOutcome,
} from './types.js';

/**
 * The generic per-match loop. Contains no game-specific logic and no knowledge of Docker, bot
 * processes, or any wire protocol — `ActionCollector` is the seam a real adapter fills in with
 * real bot processes (`@quant-fusion/runtime`'s `DockerActionCollector`); here it's just
 * an interface, so this whole module is testable with a synthetic collector and a synthetic game
 * (see test/match-runner.test.ts).
 */
export interface RequestActionArgs {
  participantId: string;
  roundId: number;
  observation: unknown;
  deadlineMs: number;
  required: boolean;
}

export type CollectedAction =
  { ok: true; action: unknown } | { ok: false; reason: MissingActionReason };

export interface ActionCollector {
  requestAction(args: RequestActionArgs): Promise<CollectedAction>;
}

export interface MatchOutcome<TResult> {
  status: 'completed' | 'forfeit' | 'match-timeout';
  /** Present when `status === 'completed'`. */
  result?: TResult;
  standingOutcomes: StandingOutcome[];
  /** Present when `status === 'forfeit'`. */
  forfeitedParticipantIds?: string[];
  /** One entry per round that reached `resolve()`; a forfeited round is not included. */
  events: RoundEvent[][];
}

export interface RunMatchArgs<TConfig, TState, TObservation, TAction, TResult> {
  game: GameDefinition<TConfig, TState, TObservation, TAction, TResult>;
  config: TConfig;
  participantIds: string[];
  rng: Rng;
  collector: ActionCollector;
  /** Used for any pending entry that doesn't specify its own `deadlineMs`. */
  defaultDeadlineMs: number;
  /**
   * The whole-match wall-clock safety net docs/adr/0003-docker-bot-isolation.md calls for:
   * every participant can be responding perfectly, on time, every single round, and the match
   * can still never terminate — e.g. two bots whose strategies converge into an infinite draw
   * cycle (`isTerminal()` only becomes true once someone reaches a majority of round *wins*, and
   * an endless run of draws never produces one). No single participant is at fault here, so this
   * is deliberately distinct from a `forfeit` — see `status: 'match-timeout'`.
   */
  matchDeadlineMs: number;
  /** Injectable clock, for deterministic tests of the above; defaults to `Date.now`. */
  now?: () => number;
  /**
   * Optional: called once per round, right after `resolve()` produces it — the seam a caller
   * (e.g. the CLI's human-play mode) uses to observe every round's events live, not just the
   * final aggregated `MatchOutcome.events` returned once the whole match ends. Never called for
   * a round that ends in forfeit (no `resolve()` ever runs for one).
   */
  onRoundResolved?: (events: RoundEvent[]) => void;
}

/** What happened when one round was played: either it resolved normally, or a required
 * participant's action never arrived/validated and nobody's `onMissingAction` policy covered it —
 * a forfeit. The per-round primitive both `runMatch` and `runAvailableRounds` share; see
 * `playOneRound`. */
export type RoundResult<TState> =
  | { kind: 'resolved'; nextState: TState; events: RoundEvent[] }
  | { kind: 'forfeit'; forfeitedParticipantIds: string[] };

/**
 * Plays exactly one round: gathers every pending participant's action concurrently (real arrival
 * order must never influence outcomes — docs/adr/0004-deterministic-randomness.md — and a slow
 * optional responder must never delay a required one), validates/applies each `onMissingAction`
 * policy, and either resolves the round or reports a forfeit. Contains no loop/termination
 * logic of its own — `runMatch` and `runAvailableRounds` are both just "call this until some
 * stopping condition," which is the only thing they actually differ on (whether `state` comes
 * from a fresh `initialize()` or an existing resumed state, and what a caller can observe about
 * where the loop stopped).
 */
async function playOneRound<TConfig, TState, TObservation, TAction, TResult>(args: {
  game: GameDefinition<TConfig, TState, TObservation, TAction, TResult>;
  state: TState;
  roundId: number;
  rng: Rng;
  collector: ActionCollector;
  defaultDeadlineMs: number;
}): Promise<RoundResult<TState>> {
  const { game, state, roundId, rng, collector, defaultDeadlineMs } = args;
  const pending = game.getPendingActions(state);

  const requests = await Promise.all(
    pending.map(async (entry) => {
      const observation = game.getObservation(state, entry.participantId);
      const collected = await collector.requestAction({
        participantId: entry.participantId,
        roundId,
        observation,
        deadlineMs: entry.deadlineMs ?? defaultDeadlineMs,
        required: entry.required,
      });
      return { entry, collected };
    }),
  );

  const actions = new Map<string, TAction>();
  const forfeitedParticipantIds: string[] = [];

  for (const { entry, collected } of requests) {
    if (collected.ok) {
      const validated = game.validateAction(state, entry.participantId, collected.action);
      if (validated.ok) {
        actions.set(entry.participantId, validated.value);
        continue;
      }
      if (!entry.required) {
        continue; // an invalid *voluntary* submission is simply ignored, not a fault
      }
      applyMissingActionPolicy(
        game,
        state,
        entry.participantId,
        'invalid',
        actions,
        forfeitedParticipantIds,
      );
      continue;
    }

    if (!entry.required) {
      continue; // no voluntary submission arrived — nothing to do
    }
    applyMissingActionPolicy(
      game,
      state,
      entry.participantId,
      collected.reason,
      actions,
      forfeitedParticipantIds,
    );
  }

  if (forfeitedParticipantIds.length > 0) {
    return { kind: 'forfeit', forfeitedParticipantIds };
  }

  const outcome = game.resolve({ state, actions, rng });
  return { kind: 'resolved', nextState: outcome.nextState, events: outcome.events };
}

export interface RunAvailableRoundsArgs<TConfig, TState, TObservation, TAction, TResult> {
  game: GameDefinition<TConfig, TState, TObservation, TAction, TResult>;
  /** An already-constructed state — `initialize()` is never called here. A fresh match passes
   * `game.initialize(...)`'s own result; a resumed one passes whatever it rebuilt from persisted
   * data (see e.g. `games/stock-market-4`'s `resumeForwardState`). */
  state: TState;
  /** Needed for forfeit/timeout standings synthesis, which can't be derived from a generic
   * `TState`. */
  participantIds: readonly string[];
  rng: Rng;
  collector: ActionCollector;
  defaultDeadlineMs: number;
  matchDeadlineMs: number;
  now?: () => number;
  /**
   * Called after EVERY round resolves, AWAITED before the loop continues — the seam a resumable
   * caller uses for durable per-round persistence. Unlike `runMatch`'s own `onRoundResolved`
   * (fire-and-forget, events-only, UI-narration seam), this one is awaited and receives `state`
   * too: a caller doing correctness-critical persistence needs its write to land before either
   * the next round starts or the process is allowed to exit, or a crash could lose more than the
   * one round genuinely in flight. Throwing here aborts the loop (propagates to the caller)
   * rather than silently continuing to play rounds whose results might never be persisted.
   */
  onRoundResolved?: (args: { state: TState; events: RoundEvent[] }) => void | Promise<void>;
  /** Round ids reported to `collector.requestAction` continue from here rather than restarting at
   * 0 — a resumed match's bots see round ids consistent with the persistent game's own history.
   * Defaults to 0 (a no-op for a fresh, non-resuming caller). */
  startingRoundId?: number;
}

export interface RunAvailableRoundsOutcome<TState, TResult> {
  /** State as of wherever this call stopped — including a non-terminal stop (a forfeit, or a
   * match-timeout) as well as a terminal one. This is exactly what `MatchOutcome` deliberately
   * never exposes (see its own doc comment) — the one capability a resumable caller needs that
   * `runMatch`'s return value can't provide. */
  finalState: TState;
  /** One entry per round that reached `resolve()` THIS CALL — a forfeited round is not included,
   * and a round resolved by an earlier call (before a resume) is not replayed into this array. */
  events: RoundEvent[][];
  terminalOutcome?:
    | { status: 'completed'; result: TResult; standingOutcomes: StandingOutcome[] }
    | { status: 'forfeit'; standingOutcomes: StandingOutcome[]; forfeitedParticipantIds: string[] }
    | { status: 'match-timeout'; standingOutcomes: StandingOutcome[] };
}

/**
 * The generic per-match loop, factored so a resumable caller can drive it starting from an
 * existing `state` rather than always calling `game.initialize()` — see `RunAvailableRoundsArgs`'s
 * own doc comments. `runMatch` below is now a thin wrapper over this; there is exactly one real
 * loop implementation, not two.
 */
export async function runAvailableRounds<TConfig, TState, TObservation, TAction, TResult>(
  args: RunAvailableRoundsArgs<TConfig, TState, TObservation, TAction, TResult>,
): Promise<RunAvailableRoundsOutcome<TState, TResult>> {
  const {
    game,
    participantIds,
    rng,
    collector,
    defaultDeadlineMs,
    matchDeadlineMs,
    onRoundResolved,
  } = args;
  const now = args.now ?? Date.now;
  const startedAt = now();
  let state = args.state;
  let roundId = args.startingRoundId ?? 0;
  const events: RoundEvent[][] = [];

  while (!game.isTerminal(state)) {
    if (now() - startedAt >= matchDeadlineMs) {
      return {
        finalState: state,
        events,
        terminalOutcome: {
          status: 'match-timeout',
          standingOutcomes: synthesizeTimeoutStandings(participantIds),
        },
      };
    }

    const roundResult = await playOneRound({
      game,
      state,
      roundId,
      rng,
      collector,
      defaultDeadlineMs,
    });

    if (roundResult.kind === 'forfeit') {
      return {
        finalState: state,
        events,
        terminalOutcome: {
          status: 'forfeit',
          standingOutcomes: synthesizeForfeitStandings(
            participantIds,
            roundResult.forfeitedParticipantIds,
          ),
          forfeitedParticipantIds: roundResult.forfeitedParticipantIds,
        },
      };
    }

    events.push(roundResult.events);
    state = roundResult.nextState;
    await onRoundResolved?.({ state, events: roundResult.events });
    roundId += 1;
  }

  const result = game.getResult(state);
  return {
    finalState: state,
    events,
    terminalOutcome: {
      status: 'completed',
      result,
      standingOutcomes: game.getStandingOutcomes(result),
    },
  };
}

export async function runMatch<TConfig, TState, TObservation, TAction, TResult>(
  args: RunMatchArgs<TConfig, TState, TObservation, TAction, TResult>,
): Promise<MatchOutcome<TResult>> {
  const { game, config, participantIds, rng, onRoundResolved } = args;
  const state = game.initialize({ config, participantIds, rng });

  const outcome = await runAvailableRounds({
    ...args,
    state,
    startingRoundId: 0,
    onRoundResolved: ({ events }) => {
      onRoundResolved?.(events);
    },
  });

  // `runAvailableRounds` only stops on terminal/forfeit/timeout when called this way (no
  // game-specific "ran out of currently-available rounds" concept exists at this generic level —
  // see docs/adr/0013-forward-match-persistence.md for the one game that introduces such a
  // concept, entirely on its own side via `isTerminal` itself), so `terminalOutcome` is always
  // set by the time this returns.
  const terminal = outcome.terminalOutcome;
  if (terminal === undefined) {
    throw new Error('unreachable: runAvailableRounds always sets terminalOutcome for runMatch');
  }
  if (terminal.status === 'completed') {
    return {
      status: 'completed',
      result: terminal.result,
      standingOutcomes: terminal.standingOutcomes,
      events: outcome.events,
    };
  }
  if (terminal.status === 'forfeit') {
    return {
      status: 'forfeit',
      standingOutcomes: terminal.standingOutcomes,
      forfeitedParticipantIds: terminal.forfeitedParticipantIds,
      events: outcome.events,
    };
  }
  return {
    status: 'match-timeout',
    standingOutcomes: terminal.standingOutcomes,
    events: outcome.events,
  };
}

function applyMissingActionPolicy<TConfig, TState, TObservation, TAction, TResult>(
  game: GameDefinition<TConfig, TState, TObservation, TAction, TResult>,
  state: TState,
  participantId: string,
  reason: MissingActionReason,
  actions: Map<string, TAction>,
  forfeitedParticipantIds: string[],
): void {
  const decision = game.onMissingAction?.({ state, participantId, reason }) ?? {
    policy: 'forfeit-match',
  };
  if (decision.policy === 'forfeit-match') {
    forfeitedParticipantIds.push(participantId);
  } else {
    actions.set(participantId, decision.action);
  }
}

/**
 * Generic match-administration, not game logic: forfeiting participants rank last, survivors
 * rank ahead of them. In the common 2-player case with exactly one forfeiter, the survivor's
 * outcome is unambiguous ("win"); beyond that, "win" doesn't generalize cleanly (docs/adr's
 * partial-forfeit policy notes) so only rank is set for survivors.
 */
function synthesizeForfeitStandings(
  participantIds: readonly string[],
  forfeitedParticipantIds: readonly string[],
): StandingOutcome[] {
  const forfeited = new Set(forfeitedParticipantIds);
  const survivors = participantIds.filter((id) => !forfeited.has(id));
  const survivorsWin = participantIds.length === 2 && survivors.length === 1;

  const outcomes: StandingOutcome[] = survivors.map((participantId) =>
    survivorsWin ? { participantId, rank: 1, outcome: 'win' } : { participantId, rank: 1 },
  );
  for (const participantId of forfeitedParticipantIds) {
    outcomes.push({ participantId, rank: 2, outcome: 'loss' });
  }
  return outcomes;
}

/**
 * A match-timeout is nobody's fault — every participant may have responded correctly, on time,
 * every round — so unlike a forfeit, everyone shares the same rank rather than winners/losers
 * being distinguished.
 */
function synthesizeTimeoutStandings(participantIds: readonly string[]): StandingOutcome[] {
  return participantIds.map((participantId) => ({ participantId, rank: 1, outcome: 'draw' }));
}
