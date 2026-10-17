import { randomUUID } from 'node:crypto';
import { recordJobRun } from '@quant-fusion/job-run-store';
import { defaultJobRunStoreDbPath } from './paths.js';
import { jobOutputContext } from './subprocess.js';

export type LiveJobStatus = 'running' | 'succeeded' | 'failed';

/** One in-flight (or recently finished) long-running action — a match run, a daily cycle, a price
 * fetch. Lives in this process's memory only: its purpose is the LIVE log a browser polls while
 * the action runs (and re-attaches to after a reload), not durable history — a finished job with
 * a `historyJobId` is ALSO written to `@quant-fusion/job-run-store`, which is what the Jobs tab's
 * run history reads. */
export interface LiveJob {
  id: string;
  kind: string;
  label: string;
  startedAt: string;
  finishedAt?: string;
  status: LiveJobStatus;
  output: string;
  /** One-line outcome, set when the job finishes. */
  summary?: string;
  /** The job's structured result (e.g. parsed decisions/moves), set when it finishes. */
  result?: unknown;
}

export interface JobOutcome {
  ok: boolean;
  summary: string;
  result?: unknown;
}

export interface JobContext {
  /** Appends a line of the job's own narration (e.g. "Step 2/3: checking pins…") to its log,
   * alongside whatever spawned commands stream into it on their own. */
  log: (line: string) => void;
}

export interface StartJobArgs {
  kind: string;
  label: string;
  /** When given, the finished run is also recorded in `@quant-fusion/job-run-store` under this id
   * (e.g. `daily-cycle:<matchId>`), so it shows up in the Jobs tab's history. */
  historyJobId?: string;
  run: (ctx: JobContext) => Promise<JobOutcome>;
}

export interface StartedJob {
  job: LiveJob;
  done: Promise<LiveJob>;
}

/** Finished jobs are kept this long so a browser that reloads (or polls a moment late) still sees
 * the final log, then dropped — durable history is `job-run-store`'s job, not this map's. */
const FINISHED_RETENTION_MS = 30 * 60 * 1000;
/** Caps memory for a pathological log (a runaway bot printing in a loop) — keeps the tail. */
const MAX_OUTPUT_CHARS = 2_000_000;

const jobs = new Map<string, LiveJob>();

function pruneFinished(now: number): void {
  for (const [id, job] of jobs) {
    if (job.finishedAt !== undefined && now - Date.parse(job.finishedAt) > FINISHED_RETENTION_MS) {
      jobs.delete(id);
    }
  }
}

function append(job: LiveJob, text: string): void {
  job.output += text;
  if (job.output.length > MAX_OUTPUT_CHARS) {
    job.output = job.output.slice(job.output.length - MAX_OUTPUT_CHARS);
  }
}

/** Starts `args.run` in the background and returns immediately. Every `runCommand`/`runCli` call
 * made inside `run` streams into this job's `output` automatically (see `jobOutputContext` in
 * `subprocess.ts`). `run` should never need to throw, but if it does the job is marked failed
 * with the error as its summary rather than becoming an unhandled rejection. */
export function startJob(rootDir: string, args: StartJobArgs): StartedJob {
  pruneFinished(Date.now());
  const job: LiveJob = {
    id: randomUUID(),
    kind: args.kind,
    label: args.label,
    startedAt: new Date().toISOString(),
    status: 'running',
    output: '',
  };
  jobs.set(job.id, job);

  const sink = (text: string): void => {
    append(job, text);
  };
  const ctx: JobContext = {
    log: (line) => {
      append(job, `${line}\n`);
    },
  };

  const done = jobOutputContext
    .run(sink, () => args.run(ctx))
    .catch((error: unknown): JobOutcome => {
      const message = error instanceof Error ? error.message : String(error);
      append(job, `\n${message}\n`);
      return { ok: false, summary: message };
    })
    .then((outcome) => {
      job.status = outcome.ok ? 'succeeded' : 'failed';
      job.finishedAt = new Date().toISOString();
      job.summary = outcome.summary;
      if (outcome.result !== undefined) job.result = outcome.result;
      if (args.historyJobId !== undefined) {
        const recorded = recordJobRun(defaultJobRunStoreDbPath(rootDir), {
          jobId: args.historyJobId,
          startedAt: job.startedAt,
          finishedAt: job.finishedAt,
          ok: outcome.ok,
          summary: outcome.summary,
          output: job.output,
        });
        if (!recorded.ok) console.error(`failed to record job run: ${recorded.reason}`);
      }
      return job;
    });

  return { job, done };
}

/** For an existing synchronous action route (run/preview/create/fetch): runs `fn` exactly as
 * before and returns its value, but ALSO as a live job — so its output streams to the header's
 * job indicator while the route's own HTTP request is still waiting. Purely additive: the route's
 * response contract is unchanged. Errors `fn` throws are rethrown to the route as before. */
export async function runAsLiveJob<T extends { ok: boolean }>(
  rootDir: string,
  meta: { kind: string; label: string },
  fn: (ctx: JobContext) => Promise<T>,
): Promise<T> {
  let value: T | undefined;
  let thrown: unknown;
  const { done } = startJob(rootDir, {
    ...meta,
    run: async (ctx) => {
      try {
        value = await fn(ctx);
      } catch (error) {
        thrown = error;
        throw error;
      }
      return { ok: value.ok, summary: value.ok ? 'Done.' : 'Failed — see the log.' };
    },
  });
  await done;
  if (value === undefined) throw thrown;
  return value;
}

export function getJob(id: string): LiveJob | undefined {
  return jobs.get(id);
}

/** Every job still running, plus any that finished in the last `recentMs` — so a header indicator
 * can show "just finished" briefly instead of a job vanishing the instant it ends. */
export function listJobs(recentMs = 60_000): LiveJob[] {
  const now = Date.now();
  pruneFinished(now);
  return [...jobs.values()]
    .filter((job) => job.finishedAt === undefined || now - Date.parse(job.finishedAt) <= recentMs)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/** Test-only: forgets every job. */
export function resetJobsForTests(): void {
  jobs.clear();
}
