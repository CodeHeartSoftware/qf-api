import type { Result, Rng, StandingOutcome } from './types.js';

export type { Rng };

/** A tournament's roster entry. Deliberately minimal — a format only needs ids to pair up. */
export interface RosterEntry {
  participantId: string;
}

/** One match a format wants run right now. */
export interface MatchDescriptor {
  matchId: string;
  participantIds: string[];
  /** Advisory only, for progress reporting — a format need not populate this meaningfully. */
  round?: number;
}

/**
 * What a format learns once a match completes. `standingOutcomes` is always
 * `StandingOutcome[]` (`GameDefinition.getStandingOutcomes`'s return shape) regardless of which
 * game produced it — this is what lets any format consume any game's result without knowing
 * that game's actual `TResult` type (docs/adr/0006-tournament-format-abstraction.md).
 */
export interface MatchRecord {
  matchId: string;
  standingOutcomes: StandingOutcome[];
}

export interface TournamentFormatInitializeArgs<TFormatConfig> {
  roster: RosterEntry[];
  config: TFormatConfig;
  rng: Rng;
}

export interface TournamentFormatInitializeResult<TFormatState, TStandings> {
  formatState: TFormatState;
  standings: TStandings;
  readyMatches: MatchDescriptor[];
  /**
   * Human-readable notices about something that happened without a match being played — e.g.
   * single elimination's byes. Purely for spectator/CLI display (`runTournament`'s `onNotice`);
   * orchestration and scoring never depend on these, and a format with nothing to report just
   * omits the field.
   */
  notices?: string[];
}

export interface TournamentFormatRecordResultArgs<TFormatState, TStandings> {
  formatState: TFormatState;
  standings: TStandings;
  match: MatchDescriptor;
  record: MatchRecord;
}

/**
 * A pluggable tournament format (round robin, single elimination, Swiss, ...). Uses an
 * incremental pull model rather than an upfront `generateSchedule()`, so both "the whole
 * schedule is knowable up front" (round robin) and "round N+1 depends on round N's winners"
 * (single elimination) fit the same contract (docs/adr/0006-tournament-format-abstraction.md).
 *
 * Deliberately lives alongside `GameDefinition` in @quant-fusion/engine, not in
 * @quant-fusion/tournament-formats: the orchestrator below (`runTournament`) needs this interface,
 * and tournament-formats' concrete implementations need engine's `StandingOutcome`/`Rng`/`Result`
 * — putting the contract in tournament-formats would make that a circular dependency. This
 * mirrors how `GameDefinition` itself lives in engine while concrete games implement it.
 */
export interface TournamentFormat<TFormatConfig, TFormatState, TStandings> {
  id: string;
  version: string;

  parseConfig(raw: unknown): Result<TFormatConfig>;

  initialize(
    args: TournamentFormatInitializeArgs<TFormatConfig>,
  ): TournamentFormatInitializeResult<TFormatState, TStandings>;

  recordResult(
    args: TournamentFormatRecordResultArgs<TFormatState, TStandings>,
  ): TournamentFormatInitializeResult<TFormatState, TStandings>;

  isComplete(args: { formatState: TFormatState; standings: TStandings }): boolean;

  /** Projects internal standings into whatever a spectator or CLI should see. */
  getPublicStandings(standings: TStandings): unknown;
}
