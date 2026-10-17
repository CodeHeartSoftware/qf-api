import type { Request, Response, Router } from 'express';
import { Router as createRouter } from 'express';
import { listJobRuns } from '@quant-fusion/job-run-store';
import { listDetachedJobs, readDetachedJob } from '../lib/detachedJobs.js';
import { getJob, listJobs, type LiveJob } from '../lib/jobRunner.js';
import { defaultJobRunStoreDbPath } from '../lib/paths.js';

/** A job's output is returned from `since` (a character offset the caller already has) onward,
 * so a poll every second doesn't resend a whole multi-megabyte log each time. */
function sliceJob(job: LiveJob, since: number): LiveJob & { outputOffset: number } {
  const offset = Math.min(Math.max(0, since), job.output.length);
  return { ...job, output: job.output.slice(offset), outputOffset: offset };
}

/** Generic, job-agnostic run history — see `@quant-fusion/job-run-store`'s own doc comment on why
 * this has no notion of what a job actually does. `jobId` is whatever the job's OWN action route
 * chose when it called `recordJobRun` (e.g. `market-data-fetch:fusion` — see
 * `marketData.ts`/`marketUniverses.ts`); this router only ever reads that log back. */
export function createJobsRouter(rootDir: string): Router {
  const router = createRouter();

  // Live (in-flight or just-finished) jobs: in-memory ones (`jobRunner.ts`) plus detached,
  // file-backed ones (`detachedJobs.ts`). Output blanked — the header indicator only needs status.
  router.get('/live', (_req: Request, res: Response) => {
    listDetachedJobs(rootDir)
      .then((detached) => {
        const jobs = [...listJobs(), ...detached]
          .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
          .map((job) => ({ ...job, output: '' }));
        res.json({ jobs });
      })
      .catch((error: unknown) => {
        res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
      });
  });

  router.get('/live/:liveJobId', (req: Request, res: Response) => {
    const id = String(req.params.liveJobId);
    const since = typeof req.query.since === 'string' ? Number(req.query.since) || 0 : 0;
    const inMemory = getJob(id);
    if (inMemory !== undefined) {
      res.json({ job: sliceJob(inMemory, since) });
      return;
    }
    readDetachedJob(rootDir, id)
      .then((job) => {
        if (job === undefined) res.status(404).json({ error: `No live job "${id}".` });
        else res.json({ job: sliceJob(job, since) });
      })
      .catch((error: unknown) => {
        res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
      });
  });

  router.get('/:jobId/runs', (req: Request, res: Response) => {
    const { jobId } = req.params;
    if (jobId === undefined) {
      res.status(400).json({ error: 'jobId is required.' });
      return;
    }
    const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
    if (limit !== undefined && (!Number.isFinite(limit) || limit < 1)) {
      res.status(400).json({ error: '"limit", when given, must be a positive number.' });
      return;
    }

    const result = listJobRuns(
      defaultJobRunStoreDbPath(rootDir),
      jobId,
      ...(limit !== undefined ? [limit] : []),
    );
    if (!result.ok) {
      res.status(500).json({ error: result.reason });
      return;
    }
    res.json({ runs: result.value });
  });

  return router;
}
