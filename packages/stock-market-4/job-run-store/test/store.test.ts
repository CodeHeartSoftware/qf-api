import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listJobRuns, recordJobRun } from '../src/store.js';
import type { NewJobRun } from '../src/types.js';

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'job-run-store-test-'));
  dbPath = join(dir, 'job-runs.sqlite');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function run(overrides: Partial<NewJobRun> = {}): NewJobRun {
  return {
    jobId: 'market-data-fetch:fusion',
    startedAt: '2026-09-19T00:00:00Z',
    finishedAt: '2026-09-19T00:00:05Z',
    ok: true,
    summary: 'Fetched 2 new bar(s).',
    output: 'full output text',
    ...overrides,
  };
}

describe('recordJobRun / listJobRuns', () => {
  it('records a run and lists it back', () => {
    const recorded = recordJobRun(dbPath, run());
    expect(recorded.ok).toBe(true);
    if (!recorded.ok) return;
    expect(recorded.value.id.length).toBeGreaterThan(0);

    const listed = listJobRuns(dbPath, 'market-data-fetch:fusion');
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value).toHaveLength(1);
    expect(listed.value[0]).toMatchObject({ jobId: 'market-data-fetch:fusion', ok: true });
  });

  it("scopes runs by jobId — a different job never sees another job's history", () => {
    recordJobRun(dbPath, run({ jobId: 'market-data-fetch:fusion' }));
    recordJobRun(dbPath, run({ jobId: 'market-data-fetch:other' }));

    const fusionRuns = listJobRuns(dbPath, 'market-data-fetch:fusion');
    expect(fusionRuns.ok && fusionRuns.value).toHaveLength(1);
    const otherRuns = listJobRuns(dbPath, 'market-data-fetch:other');
    expect(otherRuns.ok && otherRuns.value).toHaveLength(1);
  });

  it('returns most-recent-first', () => {
    recordJobRun(dbPath, run({ startedAt: '2026-09-17T00:00:00Z', summary: 'first' }));
    recordJobRun(dbPath, run({ startedAt: '2026-09-19T00:00:00Z', summary: 'second' }));

    const listed = listJobRuns(dbPath, 'market-data-fetch:fusion');
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.map((r) => r.summary)).toEqual(['second', 'first']);
  });

  it("preserves a failed run's ok:false", () => {
    recordJobRun(dbPath, run({ ok: false, summary: 'Yahoo Finance request failed' }));
    const listed = listJobRuns(dbPath, 'market-data-fetch:fusion');
    expect(listed.ok && listed.value[0]?.ok).toBe(false);
  });

  it('respects the limit', () => {
    for (let i = 0; i < 5; i++) {
      recordJobRun(dbPath, run({ startedAt: `2026-09-${String(10 + i)}T00:00:00Z` }));
    }
    const listed = listJobRuns(dbPath, 'market-data-fetch:fusion', 2);
    expect(listed.ok && listed.value).toHaveLength(2);
  });

  it('returns an empty list for a jobId with no recorded runs', () => {
    const listed = listJobRuns(dbPath, 'never-run');
    expect(listed.ok && listed.value).toEqual([]);
  });
});
