import { describe, expect, it } from 'vitest';
import { withStoredExecution } from '../src/lib/emitForwardConfig.js';

describe('withStoredExecution', () => {
  const fresh = {
    startDate: '2026-01-02',
    researchTimeline: [],
    execution: { fillTiming: 'next_open' },
  };

  it('drops the fresh default for a legacy match that never had an execution block', () => {
    expect(withStoredExecution(fresh, { startDate: '2026-01-02' })).toEqual({
      startDate: '2026-01-02',
      researchTimeline: [],
    });
  });

  it("keeps a match's own stored execution exactly", () => {
    const stored = { execution: { fillTiming: 'next_open', halfSpreadBps: 40 } };
    expect(withStoredExecution(fresh, stored)).toEqual({ ...fresh, execution: stored.execution });
  });
});
