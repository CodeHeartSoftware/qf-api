import { Readable, Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { runBot } from '../src/run-bot.js';

interface FakeIo {
  input: Readable;
  output: Writable;
  /** Pushes one NDJSON line and waits for readline to actually deliver it (stream I/O is async). */
  writeLine: (message: Record<string, unknown>) => Promise<void>;
  messages: () => Record<string, unknown>[];
}

function createFakeIo(): FakeIo {
  // eslint-disable-next-line @typescript-eslint/no-empty-function -- push-mode Readable requires a read() method; data is fed manually via input.push().
  const input = new Readable({ read() {} });
  const chunks: string[] = [];
  const output = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    },
  });
  return {
    input,
    output,
    writeLine: async (message) => {
      input.push(`${JSON.stringify(message)}\n`);
      await new Promise((resolve) => setImmediate(resolve));
    },
    messages: () =>
      chunks
        .join('')
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

/** Asserts `sentAt` looks like a timestamp, then strips it so the rest can be compared exactly. */
function expectSentAtAndStrip(message: Record<string, unknown>): Record<string, unknown> {
  expect(typeof message.sentAt).toBe('string');
  const rest = { ...message };
  delete rest.sentAt;
  return rest;
}

describe('runBot', () => {
  it('replies to init with ready', async () => {
    const io = createFakeIo();
    runBot({ decideAction: () => ({ choice: 'rock' }), input: io.input, output: io.output });

    await io.writeLine({ type: 'init', matchId: 'm1', payload: { rngSeed: 'abc', config: {} } });

    const [message] = io.messages();
    if (message === undefined) {
      throw new Error('expected runBot to send a message, got none');
    }
    expect(expectSentAtAndStrip(message)).toEqual({
      protocolVersion: '1.0',
      type: 'ready',
      matchId: 'm1',
      seq: 0,
      payload: { protocolVersion: '1.0' },
    });
  });

  it('calls onInit with the rngSeed and config before replying', async () => {
    const io = createFakeIo();
    const onInit = vi.fn();
    runBot({
      decideAction: () => ({ choice: 'rock' }),
      onInit,
      input: io.input,
      output: io.output,
    });

    await io.writeLine({
      type: 'init',
      matchId: 'm1',
      payload: { rngSeed: 'abc', config: { bestOf: 3 } },
    });

    expect(onInit).toHaveBeenCalledWith({ rngSeed: 'abc', config: { bestOf: 3 } });
  });

  it('calls decideAction and sends an action when awaitingAction is true', async () => {
    const io = createFakeIo();
    const decideAction = vi.fn(() => ({ choice: 'paper' }));
    runBot({ decideAction, input: io.input, output: io.output });

    await io.writeLine({
      type: 'observation',
      matchId: 'm1',
      roundId: 2,
      payload: { state: { round: 2 }, awaitingAction: true },
    });

    expect(decideAction).toHaveBeenCalledWith({ round: 2 });
    const [message] = io.messages();
    if (message === undefined) {
      throw new Error('expected runBot to send a message, got none');
    }
    expect(expectSentAtAndStrip(message)).toEqual({
      protocolVersion: '1.0',
      type: 'action',
      matchId: 'm1',
      roundId: 2,
      seq: 0,
      payload: { action: { choice: 'paper' } },
    });
  });

  it('does not call decideAction when awaitingAction is false', async () => {
    const io = createFakeIo();
    const decideAction = vi.fn(() => ({ choice: 'paper' }));
    runBot({ decideAction, input: io.input, output: io.output });

    await io.writeLine({
      type: 'observation',
      matchId: 'm1',
      roundId: 1,
      payload: { state: {}, awaitingAction: false },
    });

    expect(decideAction).not.toHaveBeenCalled();
    expect(io.messages()).toEqual([]);
  });

  it('calls exit(0) on match-end', async () => {
    const io = createFakeIo();
    const exit = vi.fn();
    runBot({ decideAction: () => ({ choice: 'rock' }), exit, input: io.input, output: io.output });

    await io.writeLine({ type: 'match-end', matchId: 'm1' });

    expect(exit).toHaveBeenCalledWith(0);
  });

  it('ignores malformed JSON lines without throwing', async () => {
    const io = createFakeIo();
    runBot({ decideAction: () => ({ choice: 'rock' }), input: io.input, output: io.output });

    io.input.push('not json\n');
    await new Promise((resolve) => setImmediate(resolve));

    expect(io.messages()).toEqual([]);
  });

  it('ignores messages missing type or matchId', async () => {
    const io = createFakeIo();
    const decideAction = vi.fn(() => ({ choice: 'rock' }));
    runBot({ decideAction, input: io.input, output: io.output });

    await io.writeLine({ matchId: 'm1' });
    await io.writeLine({ type: 'observation' });

    expect(decideAction).not.toHaveBeenCalled();
    expect(io.messages()).toEqual([]);
  });
});
