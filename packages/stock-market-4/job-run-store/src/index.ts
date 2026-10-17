/**
 * @quant-fusion/job-run-store — a small, generic operational log of completed Phase B job runs
 * (the Jobs tab's "Fetch Latest Price Data," and any future job): who ran what, when, whether it
 * succeeded, and its own output — so a person can see history, not just the most recent action's
 * result in the current browser tab. Deliberately generic across job identity (`jobId` is an
 * opaque, caller-defined string) rather than modeling "a market-data fetch" specifically — this
 * package has no idea what a job does, only that one ran.
 */
export { recordJobRun, listJobRuns } from './store.js';
export type { JobRun, NewJobRun } from './types.js';
export { err, ok, type Result } from './result.js';
