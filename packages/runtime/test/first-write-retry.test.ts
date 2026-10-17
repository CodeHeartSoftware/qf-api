import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FirstWriteRetryGuard } from '../src/first-write-retry.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('FirstWriteRetryGuard', () => {
  it('resends the first line if no data arrives within retryDelayMs', () => {
    const writes: string[] = [];
    const guard = new FirstWriteRetryGuard({
      retryDelayMs: 500,
      write: (line) => writes.push(line),
    });

    guard.notifyWrite('init-line');
    expect(writes).toEqual([]);

    vi.advanceTimersByTime(500);
    expect(writes).toEqual(['init-line']);
  });

  it('does not resend if data arrives before retryDelayMs elapses', () => {
    const writes: string[] = [];
    const guard = new FirstWriteRetryGuard({
      retryDelayMs: 500,
      write: (line) => writes.push(line),
    });

    guard.notifyWrite('init-line');
    vi.advanceTimersByTime(100);
    guard.notifyDataReceived();
    vi.advanceTimersByTime(1000);

    expect(writes).toEqual([]);
  });

  it('only ever arms a retry for the very first write, not subsequent ones', () => {
    const writes: string[] = [];
    const guard = new FirstWriteRetryGuard({
      retryDelayMs: 500,
      write: (line) => writes.push(line),
    });

    guard.notifyWrite('init-line');
    guard.notifyDataReceived(); // the first write landed fine
    guard.notifyWrite('observation-line'); // a later write — should never be retried

    vi.advanceTimersByTime(10_000);

    expect(writes).toEqual([]);
  });

  it('dispose() cancels a pending retry', () => {
    const writes: string[] = [];
    const guard = new FirstWriteRetryGuard({
      retryDelayMs: 500,
      write: (line) => writes.push(line),
    });

    guard.notifyWrite('init-line');
    guard.dispose();
    vi.advanceTimersByTime(1000);

    expect(writes).toEqual([]);
  });

  it('defaults retryDelayMs to 500ms', () => {
    const writes: string[] = [];
    const guard = new FirstWriteRetryGuard({ write: (line) => writes.push(line) });

    guard.notifyWrite('init-line');
    vi.advanceTimersByTime(499);
    expect(writes).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(writes).toEqual(['init-line']);
  });
});
