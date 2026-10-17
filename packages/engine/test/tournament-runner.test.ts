import { createRng } from '@quant-fusion/rng';
import { describe, expect, it } from 'vitest';
import { ok, type Result } from '../src/types.js';
import type {
  MatchDescriptor,
  MatchRecord,
  RosterEntry,
  TournamentFormat,
} from '../src/tournament.js';
import { runTournament } from '../src/tournament-runner.js';

const rng = createRng(Buffer.alloc(16, 7));

/** Asserts exactly two participants and returns them narrowed, instead of `arr[0]!`/`arr[1]!`. */
function twoParticipants(ids: readonly string[]): [string, string] {
  const [a, b] = ids;
  if (a === undefined || b === undefined) {
    throw new Error(`expected exactly 2 participantIds, got ${String(ids.length)}`);
  }
  return [a, b];
}

function requireWinner(standingOutcomes: MatchRecord['standingOutcomes']): string {
  const winner = standingOutcomes.find((outcome) => outcome.rank === 1);
  if (winner === undefined) {
    throw new Error('expected a rank-1 standing outcome');
  }
  return winner.participantId;
}

// ---------------------------------------------------------------------------
// Synthetic format 1: "everyone plays everyone once, never unlocks more" — the round-robin
// degenerate case from the ADR, without depending on @quant-fusion/tournament-formats (which
// itself depends on this package — a real implementation is exercised there instead).
// ---------------------------------------------------------------------------

interface FlatState {
  totalMatches: number;
  recordedMatches: number;
}
type FlatStandings = Record<string, number>; // participantId -> win count

class FlatPairwiseFormat implements TournamentFormat<
  Record<string, never>,
  FlatState,
  FlatStandings
> {
  id = 'flat-pairwise';
  version = '1.0.0';

  parseConfig(raw: unknown): Result<Record<string, never>> {
    return ok(raw as Record<string, never>);
  }

  initialize(args: { roster: RosterEntry[] }) {
    const ids = args.roster.map((entry) => entry.participantId);
    const readyMatches: MatchDescriptor[] = [];
    for (let i = 0; i < ids.length; i += 1) {
      const idA = ids[i];
      if (idA === undefined) {
        continue;
      }
      for (let j = i + 1; j < ids.length; j += 1) {
        const idB = ids[j];
        if (idB === undefined) {
          continue;
        }
        readyMatches.push({ matchId: `${idA}-vs-${idB}`, participantIds: [idA, idB] });
      }
    }
    const standings: FlatStandings = {};
    for (const id of ids) {
      standings[id] = 0;
    }
    return {
      formatState: { totalMatches: readyMatches.length, recordedMatches: 0 },
      standings,
      readyMatches,
    };
  }

  recordResult(args: { formatState: FlatState; standings: FlatStandings; record: MatchRecord }) {
    const standings = { ...args.standings };
    const winner = args.record.standingOutcomes.find((outcome) => outcome.rank === 1);
    if (winner) {
      standings[winner.participantId] = (standings[winner.participantId] ?? 0) + 1;
    }
    return {
      formatState: {
        totalMatches: args.formatState.totalMatches,
        recordedMatches: args.formatState.recordedMatches + 1,
      },
      standings,
      readyMatches: [],
    };
  }

  isComplete(args: { formatState: FlatState }): boolean {
    return args.formatState.recordedMatches >= args.formatState.totalMatches;
  }

  getPublicStandings(standings: FlatStandings): unknown {
    return standings;
  }
}

describe('runTournament', () => {
  it('runs every ready match and accumulates standings via recordResult', async () => {
    const format = new FlatPairwiseFormat();
    const roster: RosterEntry[] = [
      { participantId: 'a' },
      { participantId: 'b' },
      { participantId: 'c' },
    ];
    const executedMatchIds: string[] = [];

    const outcome = await runTournament({
      format,
      config: {},
      roster,
      rng,
      runMatch: (match) => {
        executedMatchIds.push(match.matchId);
        // Deterministic script: the first participant always wins.
        const [winnerId, loserId] = twoParticipants(match.participantIds);
        return Promise.resolve({
          matchId: match.matchId,
          standingOutcomes: [
            { participantId: winnerId, rank: 1, outcome: 'win' },
            { participantId: loserId, rank: 2, outcome: 'loss' },
          ],
        });
      },
    });

    expect(executedMatchIds.sort()).toEqual(['a-vs-b', 'a-vs-c', 'b-vs-c']);
    expect(outcome.matchRecords).toHaveLength(3);
    expect(outcome.standings).toEqual({ a: 2, b: 1, c: 0 });
  });

  it('feeds recordResult-unlocked matches back into the queue', async () => {
    // A minimal single-elimination-shaped format: round 1 is fixed, round 2 is unlocked only
    // once both round-1 matches are recorded, pairing the two winners.
    interface BracketState {
      round1Winners: string[];
      round1Recorded: number;
      round2Played: boolean;
    }
    type BracketStandings = string[]; // winners, in recorded order

    class TinyBracketFormat implements TournamentFormat<
      Record<string, never>,
      BracketState,
      BracketStandings
    > {
      id = 'tiny-bracket';
      version = '1.0.0';
      parseConfig(raw: unknown): Result<Record<string, never>> {
        return ok(raw as Record<string, never>);
      }
      initialize(args: { roster: RosterEntry[] }) {
        const ids = args.roster.map((entry) => entry.participantId);
        const [p1, p2] = twoParticipants(ids.slice(0, 2));
        const [p3, p4] = twoParticipants(ids.slice(2, 4));
        return {
          formatState: { round1Winners: [], round1Recorded: 0, round2Played: false },
          standings: [] as BracketStandings,
          readyMatches: [
            { matchId: 'r1-m1', participantIds: [p1, p2], round: 1 },
            { matchId: 'r1-m2', participantIds: [p3, p4], round: 1 },
          ],
        };
      }
      recordResult(args: {
        formatState: BracketState;
        standings: BracketStandings;
        match: MatchDescriptor;
        record: MatchRecord;
      }) {
        const winnerId = requireWinner(args.record.standingOutcomes);
        const round1Winners = [...args.formatState.round1Winners, winnerId];
        const round1Recorded = args.formatState.round1Recorded + 1;

        if (args.match.round === 1) {
          const readyMatches: MatchDescriptor[] =
            round1Recorded === 2
              ? [{ matchId: 'r2-final', participantIds: round1Winners, round: 2 }]
              : [];
          return {
            formatState: { round1Winners, round1Recorded, round2Played: false },
            standings: args.standings,
            readyMatches,
          };
        }
        return {
          formatState: { ...args.formatState, round2Played: true },
          standings: [...args.standings, winnerId],
          readyMatches: [],
        };
      }
      isComplete(args: { formatState: BracketState }): boolean {
        return args.formatState.round2Played;
      }
      getPublicStandings(standings: BracketStandings): unknown {
        return standings;
      }
    }

    const roster: RosterEntry[] = ['a', 'b', 'c', 'd'].map((id) => ({ participantId: id }));
    const outcome = await runTournament({
      format: new TinyBracketFormat(),
      config: {},
      roster,
      rng,
      runMatch: (match) => {
        const [winnerId, loserId] = twoParticipants(match.participantIds);
        return Promise.resolve({
          matchId: match.matchId,
          standingOutcomes: [
            { participantId: winnerId, rank: 1, outcome: 'win' },
            { participantId: loserId, rank: 2, outcome: 'loss' },
          ],
        });
      },
    });

    expect(outcome.matchRecords.map((record) => record.matchId)).toEqual([
      'r1-m1',
      'r1-m2',
      'r2-final',
    ]);
    expect(outcome.standings).toEqual(['a']);
  });

  it('calls onNotice for notices from both initialize and recordResult, in order', async () => {
    class NoticeyFormat implements TournamentFormat<Record<string, never>, number, null> {
      id = 'noticey';
      version = '1.0.0';
      parseConfig(raw: unknown): Result<Record<string, never>> {
        return ok(raw as Record<string, never>);
      }
      initialize(args: { roster: RosterEntry[] }) {
        const [a, b] = twoParticipants(args.roster.map((entry) => entry.participantId));
        return {
          formatState: 0,
          standings: null,
          readyMatches: [{ matchId: 'm1', participantIds: [a, b] }],
          notices: ['starting'],
        };
      }
      recordResult(args: { formatState: number }) {
        return {
          formatState: args.formatState + 1,
          standings: null,
          readyMatches: [],
          notices: ['finished'],
        };
      }
      isComplete(args: { formatState: number }): boolean {
        return args.formatState > 0;
      }
      getPublicStandings(): unknown {
        return null;
      }
    }

    const notices: string[] = [];
    await runTournament({
      format: new NoticeyFormat(),
      config: {},
      roster: [{ participantId: 'a' }, { participantId: 'b' }],
      rng,
      runMatch: (match) => Promise.resolve({ matchId: match.matchId, standingOutcomes: [] }),
      onNotice: (notice) => notices.push(notice),
    });

    expect(notices).toEqual(['starting', 'finished']);
  });

  it('does not throw when a format reports notices but onNotice is omitted', async () => {
    class NoticeyFormat implements TournamentFormat<Record<string, never>, boolean, null> {
      id = 'noticey';
      version = '1.0.0';
      parseConfig(raw: unknown): Result<Record<string, never>> {
        return ok(raw as Record<string, never>);
      }
      initialize(args: { roster: RosterEntry[] }) {
        const [a, b] = twoParticipants(args.roster.map((entry) => entry.participantId));
        return {
          formatState: false,
          standings: null,
          readyMatches: [{ matchId: 'm1', participantIds: [a, b] }],
          notices: ['starting'],
        };
      }
      recordResult() {
        return { formatState: true, standings: null, readyMatches: [], notices: ['finished'] };
      }
      isComplete(args: { formatState: boolean }): boolean {
        return args.formatState;
      }
      getPublicStandings(): unknown {
        return null;
      }
    }

    await expect(
      runTournament({
        format: new NoticeyFormat(),
        config: {},
        roster: [{ participantId: 'a' }, { participantId: 'b' }],
        rng,
        runMatch: (match) => Promise.resolve({ matchId: match.matchId, standingOutcomes: [] }),
      }),
    ).resolves.toBeDefined();
  });

  it('stops without running anything if initialize returns no ready matches', async () => {
    class EmptyFormat implements TournamentFormat<Record<string, never>, null, null> {
      id = 'empty';
      version = '1.0.0';
      parseConfig(raw: unknown): Result<Record<string, never>> {
        return ok(raw as Record<string, never>);
      }
      initialize() {
        return { formatState: null, standings: null, readyMatches: [] };
      }
      recordResult(args: { formatState: null; standings: null; readyMatches?: never }) {
        return { formatState: args.formatState, standings: args.standings, readyMatches: [] };
      }
      isComplete(): boolean {
        return false;
      }
      getPublicStandings(): unknown {
        return null;
      }
    }

    const ran = { count: 0 };
    const outcome = await runTournament({
      format: new EmptyFormat(),
      config: {},
      roster: [{ participantId: 'a' }],
      rng,
      runMatch: () => {
        ran.count += 1;
        return Promise.resolve({ matchId: 'never', standingOutcomes: [] });
      },
    });

    expect(ran.count).toBe(0);
    expect(outcome.matchRecords).toEqual([]);
  });
});
