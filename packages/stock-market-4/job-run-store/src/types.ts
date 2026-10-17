/**
 * One completed (successful or failed) execution of a Phase B "job" — the Jobs tab's "Fetch
 * Latest Price Data" button today, any future one tomorrow. `jobId` is caller-defined and
 * opaque to this package (e.g. `market-data-fetch:fusion`) — this package only ever stores and
 * lists runs, it has no notion of what a "job" actually does.
 */
export interface JobRun {
  id: string;
  jobId: string;
  startedAt: string;
  finishedAt: string;
  ok: boolean;
  /** A short, human-readable one-liner for a list view (e.g. "Fetched 4 new bar(s) for
   * FURUKAWA, VITZRONEXTECH.") — never re-derived from `output`, since a caller already knows
   * this at the moment the run finishes. */
  summary: string;
  /** The full combined output (the same text `ActionLog` already renders for a live run) — kept
   * so a past run's history entry is exactly as inspectable as a live one, not a lossy summary
   * only. */
  output: string;
}

export type NewJobRun = Omit<JobRun, 'id'>;
