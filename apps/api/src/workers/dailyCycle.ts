// Detached worker for one daily cycle — spawned by `lib/detachedJobs.ts`'s `startDetachedJob`
// (never imported). Runs as its own process so it survives the API's `tsx watch` restart that
// its own price-fetch rebuild triggers. Writes its narration and every spawned command's output
// to stdout (which is the job's log file), records the run in `job-run-store`, and ends with one
// `JOB_RESULT_JSON:` line the API parses back as the job's outcome.
//
// Usage: tsx apps/api/src/workers/dailyCycle.ts <rootDir> <matchId> [--repin] [--skip-fetch]
import { parseArgs } from 'node:util';
import { recordJobRun } from '@quant-fusion/job-run-store';
import { dailyCycleHistoryJobId, runDailyCycle } from '../lib/dailyCycle.js';
import { JOB_RESULT_MARKER } from '../lib/detachedJobs.js';
import type { JobOutcome } from '../lib/jobRunner.js';
import { defaultJobRunStoreDbPath } from '../lib/paths.js';
import { jobOutputContext } from '../lib/subprocess.js';

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    options: { repin: { type: 'boolean' }, 'skip-fetch': { type: 'boolean' } },
    allowPositionals: true,
  });
  const [rootDir, matchId] = positionals;
  if (rootDir === undefined || matchId === undefined) {
    throw new Error('Usage: dailyCycle.ts <rootDir> <matchId> [--repin] [--skip-fetch]');
  }

  const startedAt = new Date().toISOString();
  let output = '';
  const write = (text: string): void => {
    output += text;
    process.stdout.write(text);
  };

  const outcome: JobOutcome = await jobOutputContext
    .run(write, () =>
      runDailyCycle(
        rootDir,
        { matchId, repin: values.repin === true, skipFetch: values['skip-fetch'] === true },
        (line) => {
          write(`${line}\n`);
        },
      ),
    )
    .catch((error: unknown) => ({
      ok: false,
      summary: error instanceof Error ? error.message : String(error),
    }));

  write(`\n${outcome.summary}\n`);
  const recorded = recordJobRun(defaultJobRunStoreDbPath(rootDir), {
    jobId: dailyCycleHistoryJobId(matchId),
    startedAt,
    finishedAt: new Date().toISOString(),
    ok: outcome.ok,
    summary: outcome.summary,
    output,
  });
  if (!recorded.ok) write(`warning: failed to record this run's history: ${recorded.reason}\n`);
  process.stdout.write(`${JOB_RESULT_MARKER}${JSON.stringify(outcome)}\n`);
}

main().catch((error: unknown) => {
  const summary = error instanceof Error ? error.message : String(error);
  process.stdout.write(
    `${summary}\n${JOB_RESULT_MARKER}${JSON.stringify({ ok: false, summary })}\n`,
  );
  process.exitCode = 1;
});
