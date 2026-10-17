import path from 'node:path';
import type { MarketDatasetRef } from './forwardShadowConfig.js';
import { defaultForwardMatchStoreDbPath } from './paths.js';
import { runCommand } from './subprocess.js';

export interface EmitForwardConfigArgs {
  marketDataset: MarketDatasetRef;
  marketDataUniverse: string[];
  startDate: string;
  endDate: string;
  /** `realistic` (next-open fills plus trading costs — the game's `REALISTIC_EXECUTION`) or
   * `legacy` (same-close, cost-free fills; the config then carries no `execution` block at all). */
  execution: MatchExecutionMode;
}

export type MatchExecutionMode = 'realistic' | 'legacy';

/** A fresh config for an EXISTING match must keep that match's own fills — a config rebuilt with
 * today's default would silently switch a legacy (same-close) match to next-open fills in a
 * preview while its real runs keep same-close. Copies `stored.execution` onto `fresh`, or removes
 * it when the stored config never had one. */
export function withStoredExecution(fresh: unknown, stored: unknown): unknown {
  if (typeof fresh !== 'object' || fresh === null) return fresh;
  const rest = { ...(fresh as Record<string, unknown>) };
  delete rest.execution;
  const storedExecution =
    typeof stored === 'object' && stored !== null
      ? (stored as Record<string, unknown>).execution
      : undefined;
  return storedExecution === undefined ? rest : { ...rest, execution: storedExecution };
}

/** Regenerates a fresh FORWARD_SHADOW config against the CURRENT research fixture — the "what's
 * knowable this instant" half of `match forward preview`'s comparison (see that command's own
 * module doc comment). Never invoked via `yarn workspace <pkg> run <script>` from the repo root —
 * that wrapper always writes its own "yarn run vX"/"$ <command>" banner to stdout even with
 * `--silent`, corrupting the JSON this needs to parse — so this runs `yarn run --silent` with cwd
 * set to the package itself instead, exactly as `emitForwardMatchConfig.ts`'s own usage comment
 * prescribes. */
export async function emitFreshForwardConfig(
  rootDir: string,
  args: EmitForwardConfigArgs,
): Promise<{ ok: true; config: unknown } | { ok: false; error: string }> {
  const packageDir = path.join(rootDir, 'packages', 'stock-market-4', 'research', 'fusion');
  const dbPath =
    args.marketDataset.dbPath !== undefined
      ? path.resolve(rootDir, args.marketDataset.dbPath)
      : defaultForwardMatchStoreDbPath(rootDir);

  const result = await runCommand(
    'yarn',
    [
      'run',
      '--silent',
      'emit:forward-config',
      '--',
      '--market-dataset-id',
      args.marketDataset.id,
      '--market-dataset-version',
      args.marketDataset.version,
      '--start-date',
      args.startDate,
      '--end-date',
      args.endDate,
      '--universe',
      args.marketDataUniverse.join(','),
      '--db-path',
      dbPath,
      '--execution',
      args.execution,
    ],
    // Never streamed into a live job's log: stdout is the whole config, often megabytes.
    { cwd: packageDir, onChunk: () => undefined },
  );
  if (!result.ok) {
    return { ok: false, error: `emit:forward-config failed:\n${result.output}` };
  }
  try {
    return { ok: true, config: JSON.parse(result.stdout) as unknown };
  } catch {
    return { ok: false, error: `emit:forward-config did not print valid JSON:\n${result.output}` };
  }
}
