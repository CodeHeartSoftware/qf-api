/** One participant's actual (or would-be) move for one ticker, exactly as `match forward preview`
 * decided "right now" — see `apps/cli`'s `matchForwardPreview.ts`, which prints one
 * `PREVIEW_MOVE_JSON:<json>` line per `(participantId, ticker)` alongside its own human-readable
 * text, the same "structured marker line inside otherwise-free-form CLI output" pattern
 * `QUANT_DECISION_JSON:` already established (`parseQuantDecisions.ts`). `quantity` is absent
 * (not `0`) for an order shape the CLI's own `describeOrder` didn't recognize, or for a genuine
 * `HOLD` (no order at all) — never fabricated. `changed` is `true` only when this differs from
 * what the match's OWN stored config would have decided for the same ticker (see that CLI
 * command's module doc comment on the "stored config vs freshly regenerated" comparison) — most
 * of the time this is `false`, since nothing about a match's config usually changes between
 * creation and a later preview. */
export interface PreviewMove {
  participantId: string;
  ticker: string;
  side: string;
  quantity?: number;
  changed: boolean;
}

function isPreviewMove(value: unknown): value is PreviewMove {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.participantId === 'string' &&
    typeof v.ticker === 'string' &&
    typeof v.side === 'string' &&
    (v.quantity === undefined || typeof v.quantity === 'number') &&
    typeof v.changed === 'boolean'
  );
}

/** Pulls every `PREVIEW_MOVE_JSON:<json>` line out of a preview action's captured combined
 * output — best-effort and silent about absence/malformed lines, the same posture
 * `parseQuantDecisions` already takes for the same reason: this is enrichment on top of the real
 * action output (`ActionLog`'s raw text), never a replacement for it that could fail the whole
 * parse over one bad line. */
export function parsePreviewMoves(output: string): PreviewMove[] {
  const MARKER = 'PREVIEW_MOVE_JSON:';
  const moves: PreviewMove[] = [];
  for (const line of output.split('\n')) {
    const index = line.indexOf(MARKER);
    if (index === -1) continue;
    try {
      const parsed: unknown = JSON.parse(line.slice(index + MARKER.length));
      if (isPreviewMove(parsed)) moves.push(parsed);
    } catch {
      continue;
    }
  }
  return moves;
}
