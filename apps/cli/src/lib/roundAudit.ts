// Decision audit capture for `match forward run` — see `@quant-fusion/forward-match-store`'s
// `audit.ts`. Game-agnostic by duck-typing, same as the rest of `match forward`: works for any
// game, and records more (date, fills, rationale) for one shaped like stock-market-4.
import { createHash } from 'node:crypto';
import type { ActionCollector, CollectedAction, RequestActionArgs } from '@quant-fusion/engine';
import type { RoundAuditCollection } from '@quant-fusion/forward-match-store';

export interface CollectedRound {
  collection: RoundAuditCollection;
  action?: unknown;
  observationSha256: string;
  date?: string;
}

/** Wraps a real collector, remembering what each participant was shown (as a hash) and what it
 * submitted, per round — the engine itself never exposes submitted actions to a caller. */
export class AuditingActionCollector implements ActionCollector {
  private readonly byRound = new Map<number, Map<string, CollectedRound>>();

  constructor(private readonly inner: ActionCollector) {}

  async requestAction(args: RequestActionArgs): Promise<CollectedAction> {
    const collected = await this.inner.requestAction(args);
    const observation = args.observation as { date?: unknown } | null;
    const round = this.byRound.get(args.roundId) ?? new Map<string, CollectedRound>();
    round.set(args.participantId, {
      collection: collected.ok ? 'ok' : collected.reason,
      ...(collected.ok ? { action: collected.action } : {}),
      observationSha256: createHash('sha256')
        .update(JSON.stringify(args.observation))
        .digest('hex'),
      ...(typeof observation?.date === 'string' ? { date: observation.date } : {}),
    });
    this.byRound.set(args.roundId, round);
    return collected;
  }

  /** What was collected for `roundId`, then forgotten (each round is read exactly once). */
  take(roundId: number): Map<string, CollectedRound> {
    const round = this.byRound.get(roundId) ?? new Map<string, CollectedRound>();
    this.byRound.delete(roundId);
    return round;
  }
}

const RATIONALE_MARKER = 'QUANT_DECISION_JSON:';

/** Collects each bot's `QUANT_DECISION_JSON:` stderr lines, grouped by the decision's own `date`
 * — they can arrive after the round they belong to resolves, so they're attached by date later. */
export class RationaleCollector {
  private readonly partial = new Map<string, string>();
  private readonly byParticipant = new Map<string, Map<string, unknown[]>>();

  push(participantId: string, chunk: string): void {
    const text = (this.partial.get(participantId) ?? '') + chunk;
    const lines = text.split('\n');
    this.partial.set(participantId, lines.pop() ?? '');
    for (const line of lines) {
      const index = line.indexOf(RATIONALE_MARKER);
      if (index === -1) continue;
      try {
        const decision = JSON.parse(line.slice(index + RATIONALE_MARKER.length)) as {
          date?: unknown;
        };
        if (typeof decision.date !== 'string') continue;
        const byDate = this.byParticipant.get(participantId) ?? new Map<string, unknown[]>();
        byDate.set(decision.date, [...(byDate.get(decision.date) ?? []), decision]);
        this.byParticipant.set(participantId, byDate);
      } catch {
        // A truncated line (container killed mid-write) is skipped, never fatal.
      }
    }
  }

  entries(): { participantId: string; date: string; rationale: unknown[] }[] {
    return [...this.byParticipant].flatMap(([participantId, byDate]) =>
      [...byDate].map(([date, rationale]) => ({ participantId, date, rationale })),
    );
  }
}

/** Duck-types stock-market-4's round event (`{data: {date, fills: {[id]: Fill[]}}}`). */
export function roundDateAndFills(
  events: readonly { data?: unknown }[],
  participantId: string,
): { date?: string; fills?: unknown } {
  for (const event of events) {
    const data = event.data as { date?: unknown; fills?: Record<string, unknown> } | undefined;
    if (data === undefined || typeof data.date !== 'string') continue;
    return {
      date: data.date,
      ...(data.fills !== undefined ? { fills: data.fills[participantId] ?? [] } : {}),
    };
  }
  return {};
}

/** Duck-types stock-market-4's `getCurrentStandings` output for one participant's equity. */
export function equityCentsFor(standings: unknown, participantId: string): number | undefined {
  const list = (standings as { standings?: unknown } | undefined)?.standings;
  if (!Array.isArray(list)) return undefined;
  const entry = (list as { participantId?: unknown; equityCents?: unknown }[]).find(
    (s) => s.participantId === participantId,
  );
  return typeof entry?.equityCents === 'number' ? entry.equityCents : undefined;
}
