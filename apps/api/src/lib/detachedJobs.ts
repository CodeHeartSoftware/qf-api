import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, openSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { LiveJob } from './jobRunner.js';

/** The last line a detached worker prints — its outcome, parsed back out of its own log. Same
 * "machine-readable marker line in a human log" convention as `QUANT_DECISION_JSON:`. */
export const JOB_RESULT_MARKER = 'JOB_RESULT_JSON:';

interface DetachedJobMeta {
  id: string;
  kind: string;
  label: string;
  /** Mutual-exclusion key (e.g. `run:<matchId>`) — see `isDetachedJobRunning`. */
  key: string;
  startedAt: string;
  pid?: number;
}

/** Kept a day so last night's scheduled run is still inspectable the next morning; durable
 * history lives in `job-run-store` (each worker records its own run there). */
const RETENTION_MS = 24 * 60 * 60 * 1000;

function jobsDir(rootDir: string): string {
  return path.join(rootDir, '.quant-fusion', 'live-jobs');
}

function metaPath(rootDir: string, id: string): string {
  return path.join(jobsDir(rootDir), `${id}.json`);
}

function logPath(rootDir: string, id: string): string {
  return path.join(jobsDir(rootDir), `${id}.log`);
}

export interface StartDetachedJobArgs {
  kind: string;
  label: string;
  key: string;
  /** Repo-root-relative path to a `.ts` worker script, run under `tsx`. */
  script: string;
  args: string[];
}

/** Runs a worker script as a DETACHED process (its own process group, stdout/stderr straight into
 * a log file), so it survives this API restarting underneath it — which `tsx watch` does whenever a
 * workspace package's `dist/` is rebuilt, exactly what a daily cycle's price fetch triggers. The
 * job's state lives entirely on disk (`live-jobs/<id>.{json,log}`), so a restarted API reads it
 * straight back. Always run under `tsx` (the repo's own dev dependency), in dev and `node dist`
 * mode alike, so the worker never depends on this package's `dist/` being current. */
export async function startDetachedJob(
  rootDir: string,
  args: StartDetachedJobArgs,
): Promise<LiveJob> {
  await mkdir(jobsDir(rootDir), { recursive: true });
  const meta: DetachedJobMeta = {
    id: randomUUID(),
    kind: args.kind,
    label: args.label,
    key: args.key,
    startedAt: new Date().toISOString(),
  };
  const fd = openSync(logPath(rootDir, meta.id), 'a');
  try {
    const child = spawn(
      path.join(rootDir, 'node_modules', '.bin', 'tsx'),
      [path.join(rootDir, args.script), ...args.args],
      { cwd: rootDir, detached: true, stdio: ['ignore', fd, fd] },
    );
    child.unref();
    if (child.pid !== undefined) meta.pid = child.pid;
  } finally {
    closeSync(fd);
  }
  await writeFile(metaPath(rootDir, meta.id), JSON.stringify(meta), 'utf8');
  const job = await readDetachedJob(rootDir, meta.id);
  if (job === undefined) throw new Error(`could not read back detached job ${meta.id}`);
  return job;
}

function isProcessAlive(pid: number | undefined): boolean {
  if (pid === undefined) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means it exists but belongs to someone else — still alive.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

interface ParsedOutcome {
  ok: boolean;
  summary: string;
  result?: unknown;
}

function parseOutcome(log: string): { output: string; outcome?: ParsedOutcome } {
  const index = log.lastIndexOf(JOB_RESULT_MARKER);
  if (index === -1) return { output: log };
  const line = log.slice(index + JOB_RESULT_MARKER.length).split('\n')[0] ?? '';
  try {
    return { output: log.slice(0, index), outcome: JSON.parse(line) as ParsedOutcome };
  } catch {
    return { output: log };
  }
}

export async function readDetachedJob(rootDir: string, id: string): Promise<LiveJob | undefined> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return undefined;
  let meta: DetachedJobMeta;
  try {
    meta = JSON.parse(await readFile(metaPath(rootDir, id), 'utf8')) as DetachedJobMeta;
  } catch {
    return undefined;
  }
  const log = await readFile(logPath(rootDir, id), 'utf8').catch(() => '');
  const { output, outcome } = parseOutcome(log);
  const job: LiveJob = {
    id,
    kind: meta.kind,
    label: meta.label,
    startedAt: meta.startedAt,
    status: 'running',
    output,
  };
  if (outcome !== undefined) {
    job.status = outcome.ok ? 'succeeded' : 'failed';
    job.summary = outcome.summary;
    if (outcome.result !== undefined) job.result = outcome.result;
  } else if (!isProcessAlive(meta.pid)) {
    job.status = 'failed';
    job.summary = 'The worker process exited without reporting a result (killed or crashed).';
  }
  if (job.status !== 'running') {
    job.finishedAt =
      (await stat(logPath(rootDir, id)).catch(() => undefined))?.mtime.toISOString() ??
      meta.startedAt;
  }
  return job;
}

/** Same "running, or finished within `recentMs`" window as `jobRunner.ts`'s `listJobs`; also
 * prunes job files past `RETENTION_MS`. */
export async function listDetachedJobs(rootDir: string, recentMs = 60_000): Promise<LiveJob[]> {
  let names: string[];
  try {
    names = await readdir(jobsDir(rootDir));
  } catch {
    return [];
  }
  const now = Date.now();
  const jobs: LiveJob[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const id = name.slice(0, -'.json'.length);
    const job = await readDetachedJob(rootDir, id);
    if (job === undefined) continue;
    const finished = job.finishedAt !== undefined ? Date.parse(job.finishedAt) : undefined;
    if (finished !== undefined && now - finished > RETENTION_MS) {
      await rm(metaPath(rootDir, id), { force: true });
      await rm(logPath(rootDir, id), { force: true });
      continue;
    }
    if (finished === undefined || now - finished <= recentMs) jobs.push(job);
  }
  return jobs;
}

/** Whether a detached job holding `key` is still running — checked alongside `subprocess.ts`'s
 * in-memory `isLocked`, so a manual "Run Next Round" can't race a daily cycle on the same match. */
export async function isDetachedJobRunning(rootDir: string, key: string): Promise<boolean> {
  let names: string[];
  try {
    names = await readdir(jobsDir(rootDir));
  } catch {
    return false;
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    let meta: DetachedJobMeta;
    try {
      meta = JSON.parse(
        await readFile(path.join(jobsDir(rootDir), name), 'utf8'),
      ) as DetachedJobMeta;
    } catch {
      continue;
    }
    if (meta.key !== key) continue;
    const job = await readDetachedJob(rootDir, meta.id);
    if (job?.status === 'running') return true;
  }
  return false;
}
