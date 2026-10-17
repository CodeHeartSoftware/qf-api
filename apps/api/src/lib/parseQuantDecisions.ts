/** Pulls every `QUANT_DECISION_JSON:<json>` line a quant-sdk-js-based bot writes to its own
 * stderr (see `bots/stock-market-4/quant-v0/src/index.ts`'s `onDecision` callback) out of
 * a run/preview action's captured combined output — `apps/cli`'s `match-execution.ts` now relays
 * every bot's stderr live into its own process's stderr, which `runCli`'s `runCommand` already
 * captures into `output` alongside everything else that action printed.
 *
 * Best-effort and silent about absence: a bot that doesn't emit this marker (every non-quant-sdk
 * bot today) just contributes zero decisions, not an error — this is enrichment on top of the
 * real action output, never a replacement for it. A malformed line (truncated by a mid-write
 * process kill, say) is skipped rather than failing the whole parse. */
export function parseQuantDecisions(output: string): unknown[] {
  const MARKER = 'QUANT_DECISION_JSON:';
  const decisions: unknown[] = [];
  for (const line of output.split('\n')) {
    const index = line.indexOf(MARKER);
    if (index === -1) continue;
    try {
      decisions.push(JSON.parse(line.slice(index + MARKER.length)));
    } catch {
      continue;
    }
  }
  return decisions;
}
