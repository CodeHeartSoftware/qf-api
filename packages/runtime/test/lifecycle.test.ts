import { afterEach, describe, expect, it, vi } from 'vitest';
import { CURRENT_PROTOCOL_VERSION } from '@quant-fusion/protocol';
import { BotLifecycle } from '../src/lifecycle.js';
import { FakeBotProcess } from './fixtures/fake-bot-process.js';

const MATCH_ID = 'match-001';

function readyMessage(seq: number, protocolVersion = CURRENT_PROTOCOL_VERSION): unknown {
  return {
    protocolVersion,
    type: 'ready',
    matchId: MATCH_ID,
    seq,
    sentAt: '2026-01-01T00:00:00.000Z',
    payload: { protocolVersion },
  };
}

function actionMessage(seq: number, roundId: number, action: unknown): unknown {
  return {
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    type: 'action',
    matchId: MATCH_ID,
    roundId,
    seq,
    sentAt: '2026-01-01T00:00:01.000Z',
    payload: { action },
  };
}

function newLifecycle(): { lifecycle: BotLifecycle; process: FakeBotProcess } {
  const process = new FakeBotProcess();
  const lifecycle = new BotLifecycle({ process, matchId: MATCH_ID });
  return { lifecycle, process };
}

async function initializeSuccessfully(
  lifecycle: BotLifecycle,
  process: FakeBotProcess,
): Promise<void> {
  const promise = lifecycle.initialize(
    {
      gameId: 'rps',
      gameVersion: '1.0.0',
      participantId: process.participantId,
      roster: ['p1', 'p2'],
      rngSeed: 'x',
      config: {},
    },
    { initTimeoutMs: 1000 },
  );
  process.emitMessage(readyMessage(0));
  const outcome = await promise;
  expect(outcome).toEqual({ ok: true });
}

describe('BotLifecycle.initialize', () => {
  it('transitions spawning -> awaiting-ready -> running on a valid ready reply', async () => {
    const { lifecycle, process } = newLifecycle();
    expect(lifecycle.state).toBe('spawning');

    const promise = lifecycle.initialize(
      {
        gameId: 'rps',
        gameVersion: '1.0.0',
        participantId: 'p1',
        roster: ['p1', 'p2'],
        rngSeed: 'x',
        config: {},
      },
      { initTimeoutMs: 1000 },
    );
    expect(lifecycle.state).toBe('awaiting-ready');
    expect(process.lastSentMessage).toMatchObject({ type: 'init' });

    process.emitMessage(readyMessage(0));
    expect(await promise).toEqual({ ok: true });
    expect(lifecycle.state).toBe('running');
  });

  it('rejects an unsupported protocol version and terminates', async () => {
    const { lifecycle, process } = newLifecycle();
    const promise = lifecycle.initialize(
      {
        gameId: 'rps',
        gameVersion: '1.0.0',
        participantId: 'p1',
        roster: ['p1'],
        rngSeed: 'x',
        config: {},
      },
      { initTimeoutMs: 1000 },
    );
    process.emitMessage(readyMessage(0, '99.0'));
    const outcome = await promise;
    expect(outcome).toMatchObject({ ok: false, forfeitReason: 'PROTOCOL_VERSION_UNSUPPORTED' });
    expect(lifecycle.state).toBe('terminated');
    expect(process.killSignals).toEqual(['SIGKILL']);
  });

  it('times out with INIT_TIMEOUT if no ready arrives', async () => {
    vi.useFakeTimers();
    const { lifecycle, process } = newLifecycle();
    const promise = lifecycle.initialize(
      {
        gameId: 'rps',
        gameVersion: '1.0.0',
        participantId: 'p1',
        roster: ['p1'],
        rngSeed: 'x',
        config: {},
      },
      { initTimeoutMs: 5000 },
    );
    await vi.advanceTimersByTimeAsync(5000);
    const outcome = await promise;
    expect(outcome).toMatchObject({ ok: false, forfeitReason: 'INIT_TIMEOUT' });
    expect(process.killSignals).toEqual(['SIGKILL']);
    vi.useRealTimers();
  });
});

describe('BotLifecycle action request/reply', () => {
  it('correlates a valid action to the awaited roundId', async () => {
    const { lifecycle, process } = newLifecycle();
    await initializeSuccessfully(lifecycle, process);

    lifecycle.sendObservation(1, { state: {}, awaitingAction: true });
    const promise = lifecycle.awaitAction(1, 5000);
    process.emitMessage(actionMessage(1, 1, { choice: 'rock' }));

    expect(await promise).toEqual({ ok: true, action: { choice: 'rock' } });
    expect(lifecycle.state).toBe('running');
  });

  it('treats a roundId mismatch as a protocol violation', async () => {
    const { lifecycle, process } = newLifecycle();
    await initializeSuccessfully(lifecycle, process);

    lifecycle.sendObservation(2, { state: {}, awaitingAction: true });
    const promise = lifecycle.awaitAction(2, 5000);
    process.emitMessage(actionMessage(1, 999, { choice: 'rock' }));

    expect(await promise).toMatchObject({ ok: false, forfeitReason: 'PROTOCOL_VIOLATION' });
    expect(lifecycle.state).toBe('terminated');
  });

  it('treats a resign as a clean RESIGNED forfeit', async () => {
    const { lifecycle, process } = newLifecycle();
    await initializeSuccessfully(lifecycle, process);

    lifecycle.sendObservation(1, { state: {}, awaitingAction: true });
    const promise = lifecycle.awaitAction(1, 5000);
    process.emitMessage({
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      type: 'resign',
      matchId: MATCH_ID,
      seq: 1,
      sentAt: '2026-01-01T00:00:01.000Z',
      payload: { note: 'no good move' },
    });

    expect(await promise).toEqual({ ok: false, forfeitReason: 'RESIGNED', detail: 'no good move' });
    // resign is a voluntary forfeit of this round's action, not an immediate kill — the caller
    // (a future match-runner) decides whether/how to end the match.
    expect(lifecycle.state).toBe('running');
  });

  it('treats a bot self-reported error as BOT_CRASHED', async () => {
    const { lifecycle, process } = newLifecycle();
    await initializeSuccessfully(lifecycle, process);

    lifecycle.sendObservation(1, { state: {}, awaitingAction: true });
    const promise = lifecycle.awaitAction(1, 5000);
    process.emitMessage({
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      type: 'error',
      matchId: MATCH_ID,
      seq: 1,
      sentAt: '2026-01-01T00:00:01.000Z',
      payload: { detail: 'uncaught exception' },
    });

    expect(await promise).toEqual({
      ok: false,
      forfeitReason: 'BOT_CRASHED',
      detail: 'uncaught exception',
    });
  });

  it('times out with TURN_TIMEOUT and kills the process', async () => {
    vi.useFakeTimers();
    const { lifecycle, process } = newLifecycle();
    await initializeSuccessfully(lifecycle, process);

    lifecycle.sendObservation(1, { state: {}, awaitingAction: true });
    const promise = lifecycle.awaitAction(1, 3000);
    await vi.advanceTimersByTimeAsync(3000);

    expect(await promise).toMatchObject({ ok: false, forfeitReason: 'TURN_TIMEOUT' });
    expect(process.killSignals).toEqual(['SIGKILL']);
    vi.useRealTimers();
  });
});

describe('BotLifecycle protocol-shape violations', () => {
  it('rejects malformed JSON as a protocol violation and kills the process', async () => {
    const { lifecycle, process } = newLifecycle();
    await initializeSuccessfully(lifecycle, process);

    lifecycle.sendObservation(1, { state: {}, awaitingAction: true });
    const promise = lifecycle.awaitAction(1, 5000);
    process.emitLine('{not valid json');

    expect(await promise).toMatchObject({ ok: false, forfeitReason: 'PROTOCOL_VIOLATION' });
    expect(process.killSignals).toEqual(['SIGKILL']);
  });

  it('rejects a duplicate/out-of-order seq', async () => {
    const { lifecycle, process } = newLifecycle();
    // seq 0 used for `ready` — reuse it for a second message to trigger the violation.
    const promise = lifecycle.initialize(
      {
        gameId: 'rps',
        gameVersion: '1.0.0',
        participantId: 'p1',
        roster: ['p1'],
        rngSeed: 'x',
        config: {},
      },
      { initTimeoutMs: 1000 },
    );
    process.emitMessage(readyMessage(0));
    await promise;

    lifecycle.sendObservation(1, { state: {}, awaitingAction: true });
    const actionPromise = lifecycle.awaitAction(1, 5000);
    process.emitMessage(actionMessage(0, 1, { choice: 'rock' })); // seq 0 again — duplicate

    expect(await actionPromise).toMatchObject({ ok: false, forfeitReason: 'PROTOCOL_VIOLATION' });
  });

  it('surfaces a framing error (oversized line) as a protocol violation', async () => {
    const { lifecycle, process } = newLifecycle();
    await initializeSuccessfully(lifecycle, process);

    lifecycle.sendObservation(1, { state: {}, awaitingAction: true });
    const promise = lifecycle.awaitAction(1, 5000);
    process.emitFramingError(new Error('line exceeds maximum length of 1048576 bytes'));

    expect(await promise).toMatchObject({ ok: false, forfeitReason: 'PROTOCOL_VIOLATION' });
  });
});

describe('BotLifecycle duplicate-ready tolerance', () => {
  // A benign side effect of DockerBotProcess's first-write retry (src/first-write-retry.ts): if
  // the original "init" write was merely slow rather than truly lost, a resend can provoke a
  // second "ready" the bot never should have needed to send. Exactly one is tolerated.
  it('tolerates exactly one stray "ready" after initialize has already resolved', async () => {
    const { lifecycle, process } = newLifecycle();
    await initializeSuccessfully(lifecycle, process);

    process.emitMessage(readyMessage(1));

    expect(lifecycle.state).toBe('running');
    expect(process.killSignals).toEqual([]);
    expect(lifecycle.getTerminalFailure()).toBeUndefined();
  });

  it('treats a second stray "ready" as a real protocol violation', async () => {
    const { lifecycle, process } = newLifecycle();
    await initializeSuccessfully(lifecycle, process);

    process.emitMessage(readyMessage(1)); // tolerated
    process.emitMessage(readyMessage(2)); // not tolerated a second time

    expect(lifecycle.state).toBe('terminated');
    expect(lifecycle.getTerminalFailure()).toMatchObject({ forfeitReason: 'PROTOCOL_VIOLATION' });
  });

  it('does not tolerate an unexpected message of any other type with no pending request', async () => {
    const { lifecycle, process } = newLifecycle();
    await initializeSuccessfully(lifecycle, process);

    process.emitMessage(actionMessage(1, 0, { choice: 'rock' }));

    expect(lifecycle.state).toBe('terminated');
    expect(lifecycle.getTerminalFailure()).toMatchObject({ forfeitReason: 'PROTOCOL_VIOLATION' });
  });
});

describe('BotLifecycle process exit handling', () => {
  it('maps an unexpected non-OOM exit while awaiting a reply to BOT_CRASHED', async () => {
    const { lifecycle, process } = newLifecycle();
    await initializeSuccessfully(lifecycle, process);

    lifecycle.sendObservation(1, { state: {}, awaitingAction: true });
    const promise = lifecycle.awaitAction(1, 5000);
    process.emitExit({ code: 1, signal: null, oomKilled: false });

    expect(await promise).toMatchObject({ ok: false, forfeitReason: 'BOT_CRASHED' });
    expect(lifecycle.state).toBe('terminated');
  });

  it('maps an OOM-killed exit to RESOURCE_LIMIT_EXCEEDED', async () => {
    const { lifecycle, process } = newLifecycle();
    await initializeSuccessfully(lifecycle, process);

    lifecycle.sendObservation(1, { state: {}, awaitingAction: true });
    const promise = lifecycle.awaitAction(1, 5000);
    process.emitExit({ code: 137, signal: null, oomKilled: true });

    expect(await promise).toMatchObject({ ok: false, forfeitReason: 'RESOURCE_LIMIT_EXCEEDED' });
  });

  it('does not treat exit during finish() as a fault', async () => {
    const { lifecycle, process } = newLifecycle();
    await initializeSuccessfully(lifecycle, process);

    const finishPromise = lifecycle.finish({ result: { winner: 'p1' }, reason: 'completed' });
    expect(process.stdinClosed).toBe(true);
    process.emitExit({ code: 0, signal: null, oomKilled: false });

    await finishPromise;
    expect(lifecycle.state).toBe('terminated');
    expect(lifecycle.getTerminalFailure()).toBeUndefined();
    expect(process.killSignals).toEqual([]); // exited on its own before any escalation
  });

  it('escalates SIGTERM then SIGKILL if the process does not exit after match-end', async () => {
    vi.useFakeTimers();
    const { lifecycle, process } = newLifecycle();
    await initializeSuccessfully(lifecycle, process);

    const finishPromise = lifecycle.finish({ result: { winner: 'p1' }, reason: 'completed' });
    await vi.advanceTimersByTimeAsync(2000); // grace period elapses, no exit
    await vi.advanceTimersByTimeAsync(2000); // SIGTERM grace period elapses, no exit
    process.emitExit({ code: 137, signal: null, oomKilled: false }); // dies to SIGKILL

    await finishPromise;
    expect(process.killSignals).toEqual(['SIGTERM', 'SIGKILL']);
    vi.useRealTimers();
  });
});

describe('BotLifecycle.forceTerminate', () => {
  it('immediately terminates and kills the process from any state', async () => {
    const { lifecycle, process } = newLifecycle();
    await initializeSuccessfully(lifecycle, process);

    const outcome = lifecycle.forceTerminate('MATCH_TIMEOUT', 'whole-match wall clock exceeded');
    expect(outcome).toEqual({
      ok: false,
      forfeitReason: 'MATCH_TIMEOUT',
      detail: 'whole-match wall clock exceeded',
    });
    expect(lifecycle.state).toBe('terminated');
    expect(process.killSignals).toEqual(['SIGKILL']);
  });

  it('is idempotent once already terminated', async () => {
    const { lifecycle, process } = newLifecycle();
    await initializeSuccessfully(lifecycle, process);

    const first = lifecycle.forceTerminate('MATCH_TIMEOUT', 'first');
    const second = lifecycle.forceTerminate('ENGINE_ERROR', 'second');
    expect(second).toEqual(first);
    expect(process.killSignals).toEqual(['SIGKILL']); // not killed twice
  });
});

describe('BotLifecycle diagnostics', () => {
  it('accumulates stderr chunks captured via the process', () => {
    const { lifecycle, process } = newLifecycle();
    expect(lifecycle.getStderrLog()).toBe('');

    process.emitStderr('starting up\n');
    process.emitStderr('warning: low on memory\n');

    expect(lifecycle.getStderrLog()).toBe('starting up\nwarning: low on memory\n');
  });
});

afterEach(() => {
  vi.useRealTimers();
});
