import type { Rng } from '@quant-fusion/rng';

export type { Rng };

/** The uniform error-handling idiom at every game/engine boundary crossing. */
export type Result<T> = { ok: true; value: T } | { ok: false; reason: string };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T = never>(reason: string): Result<T> {
  return { ok: false, reason };
}

/**
 * One entry per participant a game reports as part of the current round
 * (docs/architecture.md §5). `required` is what lets a single generic collection loop serve
 * both "exactly one actor" (chess) and "everyone" (rock-paper-scissors) without the engine ever
 * special-casing either shape.
 */
export interface PendingAction {
  participantId: string;
  required: boolean;
  /** Advisory only; passed through to the wire protocol verbatim. True legality is `validateAction`'s job. */
  actionSchema?: unknown;
  /** Overrides the caller's default deadline for this one entry. */
  deadlineMs?: number;
}

export interface RoundEvent {
  type: string;
  participantIds?: string[];
  /** Opaque to the engine; consumed only by replay/spectator tooling. */
  data?: unknown;
}

export interface RoundOutcome<TState> {
  nextState: TState;
  events: RoundEvent[];
}

/** Why a required participant's action didn't arrive — collapsed from runtime-level detail. */
export type MissingActionReason = 'timeout' | 'invalid' | 'disconnected';

export type MissingActionDecision<TAction> =
  { policy: 'substitute'; action: TAction } | { policy: 'forfeit-match' };

export interface StandingOutcome {
  participantId: string;
  /** 1 = best; ties share a rank. */
  rank: number;
  score?: number;
  outcome?: 'win' | 'loss' | 'draw';
}

/**
 * A game is responsible for: creating initial state, producing player-specific observations,
 * determining whose actions are required this round, validating and resolving actions,
 * advancing state, deciding when the game ends, and translating its own result into a
 * generic standings shape any `TournamentFormat` can consume. It is never responsible for
 * anything about *how* actions are collected (timeouts, transport, bot processes) — that's
 * the engine/runtime's job (docs/adr/0005-observation-vs-game-state.md).
 */
export interface GameDefinition<TConfig, TState, TObservation, TAction, TResult> {
  id: string;
  version: string;

  parseConfig(raw: unknown): Result<TConfig>;

  /**
   * Optional: what a bot actually receives as `init`'s `payload.config` (docs/guides/
   * protocol-reference.md) — omitted (the common case) means the engine sends the full, parsed
   * config verbatim, exactly as before this existed. A game implements this only when some part
   * of its own config must stay organizer-only: real, tunable config a match organizer can set,
   * but never information a bot's own strategy should be able to read directly (e.g. stock-market
   * hides each news event's exact fundamental-value effect this way, while still letting a bot
   * see the event's `type` and everything else in config — games/stock-market/src/game.ts).
   * `TState.config`/`resolve()`/`initialize()` always keep the full, un-redacted config; only the
   * wire copy handed to bots is affected.
   */
  redactConfigForBots?(config: TConfig): unknown;

  initialize(args: { config: TConfig; participantIds: string[]; rng: Rng }): TState;

  /**
   * The SOLE authority for what a participant may see. The engine forwards this verbatim and
   * never inspects, redacts, or infers observations from `TState` itself.
   */
  getObservation(state: TState, participantId: string): TObservation;

  getPendingActions(state: TState): PendingAction[];

  validateAction(state: TState, participantId: string, rawAction: unknown): Result<TAction>;

  resolve(args: {
    state: TState;
    actions: ReadonlyMap<string, TAction>;
    rng: Rng;
  }): RoundOutcome<TState>;

  /**
   * The one game-facing extension point in the entire timeout/forfeit path. Omitted (or
   * returning `undefined`) means the engine default applies: forfeit the whole match. A game
   * may opt into leniency (e.g. "auto-lose just this round") by returning a substitute action
   * its own `resolve()` already knows how to interpret.
   */
  onMissingAction?(args: {
    state: TState;
    participantId: string;
    reason: MissingActionReason;
  }): MissingActionDecision<TAction>;

  isTerminal(state: TState): boolean;

  getResult(state: TState): TResult;

  /** The seam that lets any `TournamentFormat` consume any game's result without knowing `TResult`. */
  getStandingOutcomes(result: TResult): StandingOutcome[];

  /** Every game must declare limits; the runtime interprets/enforces them (opaque here). */
  resourceLimits: unknown;

  /**
   * Opt-in support for a human playing this game interactively, one action at a time, through a
   * terminal (`quant-fusion play`). Omitted entirely means the game doesn't support human play
   * yet — the CLI reports that clearly rather than falling back to some generic, lossy rendering
   * of `TObservation`. `parseInput` is the sole authority on what counts as well-formed typed
   * input; returning `undefined` tells the CLI the line didn't parse, so it can reprompt without
   * that ever reaching `validateAction`/`resolve()` as a real (and possibly game-illegal) action.
   */
  humanInterface?: {
    describeObservation(observation: TObservation): string;
    parseInput(raw: string): TAction | undefined;
    /**
     * Optional: catches an action that parsed fine but isn't legal right now — e.g. a raise
     * outside the observation's own min/max — using only what `TObservation` already reveals to
     * this participant (no access to the full `TState`, same constraint as `parseInput`). Return
     * a human-readable reason to have the CLI reprompt with it instead of forwarding the action;
     * return `undefined` to let it through. `validateAction` still re-checks against the
     * authoritative `TState` afterward regardless — this only exists so a human's out-of-range
     * input gets a retry instead of being treated as a no-show and forfeiting the match (a bot's
     * own equivalent mistake has no such recovery, by design: see `onMissingAction`). Omit if
     * every parseable action for this game is always legal whenever it's offered.
     */
    validateInput?(action: TAction, observation: TObservation): string | undefined;
    /**
     * Optional: confirms the action `parseInput` just accepted, printed immediately after —
     * e.g. "Passed: 2C 5C TH" — before the next observation's prompt. Lets a human verify their
     * input was understood as intended (not just that *something* was accepted), which matters
     * most for a game with enough notation for a typo to silently parse into the wrong-but-valid
     * action. Omit if the next prompt already makes the outcome obvious on its own.
     */
    describeAction?(action: TAction): string;

    /**
     * Optional: narrates a round's events for a human bystander — called once per resolved
     * round with that round's `events` and the human's own participant id, even on a round
     * where it isn't their turn (see `RunMatchArgs.onRoundResolved`, match-runner.ts). This is
     * the only way a human ever learns what happened in a round they weren't asked to act in —
     * `describeObservation` only ever fires on their own turn, which never comes again once
     * they're eliminated from the match (e.g. busted out of a poker hand they went all-in on).
     * Return `undefined` for a round with nothing worth narrating.
     */
    describeRoundEvents?(events: RoundEvent[], youParticipantId: string): string | undefined;
  };
}
