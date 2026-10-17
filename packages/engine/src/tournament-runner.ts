import type { MatchDescriptor, MatchRecord, RosterEntry, TournamentFormat } from './tournament.js';
import type { Rng } from './types.js';

/**
 * Runs one match to completion and returns its record. Contains no knowledge of Docker, the bot
 * registry, or any particular game — the caller (a CLI command, typically) owns building that
 * closure around @quant-fusion/runtime + @quant-fusion/registry, exactly as it already does for a
 * single `match run`. This is what keeps this whole module testable with a synthetic executor
 * (see test/tournament-runner.test.ts), the same way `runMatch()` is testable with a synthetic
 * `ActionCollector`.
 */
export type MatchExecutor = (match: MatchDescriptor) => Promise<MatchRecord>;

export interface RunTournamentArgs<TFormatConfig, TFormatState, TStandings> {
  format: TournamentFormat<TFormatConfig, TFormatState, TStandings>;
  config: TFormatConfig;
  roster: RosterEntry[];
  rng: Rng;
  runMatch: MatchExecutor;
  /**
   * Called with each notice a format emits (`TournamentFormatInitializeResult.notices`), in
   * order, as soon as it's produced — e.g. right after `initialize`, or interleaved between
   * matches whenever `recordResult` reports one. Purely advisory for spectator/CLI display;
   * omitting it drops the notices on the floor without affecting orchestration.
   */
  onNotice?: (notice: string) => void;
}

export interface TournamentOutcome<TStandings> {
  standings: TStandings;
  matchRecords: MatchRecord[];
}

/**
 * The generic pull-loop from docs/adr/0006-tournament-format-abstraction.md: pull ready matches,
 * run them (one at a time — a format's `recordResult` may depend on a prior match in the same
 * batch, e.g. single elimination within one round), feed results back, repeat until the format
 * says it's done or there's nothing left to run.
 */
export async function runTournament<TFormatConfig, TFormatState, TStandings>(
  args: RunTournamentArgs<TFormatConfig, TFormatState, TStandings>,
): Promise<TournamentOutcome<TStandings>> {
  const { format, config, roster, rng, runMatch, onNotice } = args;

  const initial = format.initialize({ roster, config, rng });
  initial.notices?.forEach((notice) => onNotice?.(notice));
  let formatState = initial.formatState;
  let standings = initial.standings;
  const queue = [...initial.readyMatches];
  const matchRecords: MatchRecord[] = [];

  while (queue.length > 0 && !format.isComplete({ formatState, standings })) {
    const match = queue.shift();
    if (match === undefined) {
      break; // unreachable given the queue.length > 0 check, but keeps TS's control-flow honest
    }

    const record = await runMatch(match);
    matchRecords.push(record);

    const next = format.recordResult({ formatState, standings, match, record });
    next.notices?.forEach((notice) => onNotice?.(notice));
    formatState = next.formatState;
    standings = next.standings;
    queue.push(...next.readyMatches);
  }

  return { standings, matchRecords };
}
