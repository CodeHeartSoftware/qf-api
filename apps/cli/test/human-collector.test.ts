import { Readable, Writable } from 'node:stream';
import type { ActionCollector, CollectedAction, RequestActionArgs } from '@quant-fusion/engine';
import { describe, expect, it } from 'vitest';
import { TerminalHumanCollector } from '../src/lib/human-collector.js';
import type { AnyGameDefinition } from '../src/lib/match-execution.js';

/** A minimal fake `GameDefinition` — only `humanInterface` and `id` matter to this collector. */
function fakeGame(
  options: {
    withHumanInterface?: boolean;
    withDescribeAction?: boolean;
    withValidateInput?: boolean;
  } = {},
): AnyGameDefinition {
  const {
    withHumanInterface = true,
    withDescribeAction = false,
    withValidateInput = false,
  } = options;
  return {
    id: 'fake-game',
    version: '1.0.0',
    parseConfig: () => ({ ok: true, value: {} }),
    initialize: () => ({}),
    getObservation: () => ({}),
    getPendingActions: () => [],
    validateAction: () => ({ ok: true, value: {} }),
    resolve: () => ({ nextState: {}, events: [] }),
    isTerminal: () => false,
    getResult: () => ({}),
    getStandingOutcomes: () => [],
    resourceLimits: {},
    ...(withHumanInterface
      ? {
          humanInterface: {
            describeObservation: (observation: unknown) =>
              `prompt:${JSON.stringify(observation)}> `,
            // "valid" always parses; "out-of-range" also parses (syntactically well-formed) but
            // is rejected downstream by validateInput below — mirrors a raise amount that's a
            // fine positive integer but outside the observation's min/max.
            parseInput: (raw: string) =>
              raw === 'valid' || raw === 'out-of-range' ? { picked: raw } : undefined,
            ...(withValidateInput
              ? {
                  validateInput: (action: unknown) =>
                    (action as { picked: string }).picked === 'out-of-range'
                      ? 'that amount is outside the legal range'
                      : undefined,
                }
              : {}),
            ...(withDescribeAction
              ? { describeAction: (action: unknown) => `confirmed:${JSON.stringify(action)}` }
              : {}),
          },
        }
      : {}),
  };
}

function outputSink(): { output: Writable; text: () => string } {
  const chunks: string[] = [];
  const output = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    },
  });
  return { output, text: () => chunks.join('') };
}

class FakeFallback implements ActionCollector {
  calls: RequestActionArgs[] = [];

  requestAction(args: RequestActionArgs): Promise<CollectedAction> {
    this.calls.push(args);
    return Promise.resolve({ ok: true, action: { fallback: true } });
  }
}

const BASE_ARGS: RequestActionArgs = {
  participantId: 'you',
  roundId: 0,
  observation: { round: 1 },
  deadlineMs: 5000,
  required: true,
};

describe('TerminalHumanCollector', () => {
  it('delegates non-human participant ids to the fallback collector untouched', async () => {
    const fallback = new FakeFallback();
    const collector = new TerminalHumanCollector({
      humanParticipantId: 'you',
      game: fakeGame(),
      fallback,
      input: Readable.from([]),
    });

    const result = await collector.requestAction({ ...BASE_ARGS, participantId: 'bot-1' });

    expect(result).toEqual({ ok: true, action: { fallback: true } });
    expect(fallback.calls).toHaveLength(1);
  });

  it('prompts, reprompts on unparseable input, and returns the parsed action once valid', async () => {
    const { output, text } = outputSink();
    const collector = new TerminalHumanCollector({
      humanParticipantId: 'you',
      game: fakeGame(),
      fallback: new FakeFallback(),
      input: Readable.from(['garbage\n', 'valid\n']),
      output,
    });

    const result = await collector.requestAction(BASE_ARGS);

    expect(result).toEqual({ ok: true, action: { picked: 'valid' } });
    // prompted twice: once before the garbage line, once more before the valid one
    expect(text().split('prompt:').length - 1).toBe(2);
  });

  it('tells the human their last input was not understood, but only on a retry', async () => {
    const { output, text } = outputSink();
    const collector = new TerminalHumanCollector({
      humanParticipantId: 'you',
      game: fakeGame(),
      fallback: new FakeFallback(),
      input: Readable.from(['garbage\n', 'valid\n']),
      output,
    });

    await collector.requestAction(BASE_ARGS);

    const notice = "Sorry, I didn't understand that — try again.";
    // Exactly once — never before the first attempt, since nothing has been rejected yet.
    expect(text().split(notice).length - 1).toBe(1);
    expect(text().indexOf(notice)).toBeLessThan(text().lastIndexOf('prompt:'));
  });

  it('reprompts with the reason on a well-formed but out-of-range action, instead of returning it', async () => {
    const { output, text } = outputSink();
    const collector = new TerminalHumanCollector({
      humanParticipantId: 'you',
      game: fakeGame({ withValidateInput: true }),
      fallback: new FakeFallback(),
      input: Readable.from(['out-of-range\n', 'valid\n']),
      output,
    });

    const result = await collector.requestAction(BASE_ARGS);

    expect(result).toEqual({ ok: true, action: { picked: 'valid' } });
    expect(text()).toContain('that amount is outside the legal range — try again.');
    // prompted twice: once before the out-of-range line, once more before the valid one
    expect(text().split('prompt:').length - 1).toBe(2);
  });

  it('never calls validateInput when the game does not declare it', async () => {
    const collector = new TerminalHumanCollector({
      humanParticipantId: 'you',
      game: fakeGame({ withValidateInput: false }),
      fallback: new FakeFallback(),
      input: Readable.from(['out-of-range\n']),
      output: outputSink().output,
    });

    // With no validateInput declared, "out-of-range" parses successfully and is returned as-is —
    // the fake game's own validateInput logic never runs to reject it.
    const result = await collector.requestAction(BASE_ARGS);

    expect(result).toEqual({ ok: true, action: { picked: 'out-of-range' } });
  });

  it("prints the game's describeAction confirmation immediately after a valid parse, with no stray blank line before it", async () => {
    const { output, text } = outputSink();
    const collector = new TerminalHumanCollector({
      humanParticipantId: 'you',
      game: fakeGame({ withDescribeAction: true }),
      fallback: new FakeFallback(),
      input: Readable.from(['valid\n']),
      output,
    });

    const result = await collector.requestAction(BASE_ARGS);

    expect(result).toEqual({ ok: true, action: { picked: 'valid' } });
    expect(text()).toContain(`confirmed:${JSON.stringify({ picked: 'valid' })}`);
    expect(text()).not.toContain('\n\nconfirmed:');
  });

  it('separates the prompt from the input point with a newline and a prompt marker', async () => {
    const { output, text } = outputSink();
    const collector = new TerminalHumanCollector({
      humanParticipantId: 'you',
      game: fakeGame(),
      fallback: new FakeFallback(),
      input: Readable.from(['valid\n']),
      output,
    });

    await collector.requestAction(BASE_ARGS);

    // describeObservation's own output ends in "> " (per the fake game above) — the real
    // separator this test is pinning down is the "\n> " the collector adds after it, so what's
    // actually written is "...> \n> " (the fake's own trailing "> ", then the collector's).
    expect(text()).toContain('> \n> ');
  });

  it('omits any confirmation line when the game has no describeAction', async () => {
    const { output, text } = outputSink();
    const collector = new TerminalHumanCollector({
      humanParticipantId: 'you',
      game: fakeGame(),
      fallback: new FakeFallback(),
      input: Readable.from(['valid\n']),
      output,
    });

    await collector.requestAction(BASE_ARGS);

    expect(text()).not.toContain('confirmed:');
  });

  it('treats "quit" as a disconnect (forfeit), not a parse attempt', async () => {
    const collector = new TerminalHumanCollector({
      humanParticipantId: 'you',
      game: fakeGame(),
      fallback: new FakeFallback(),
      input: Readable.from(['quit\n']),
      output: outputSink().output,
    });

    const result = await collector.requestAction(BASE_ARGS);

    expect(result).toEqual({ ok: false, reason: 'disconnected' });
  });

  it('treats stdin ending with no answer as a disconnect too', async () => {
    const collector = new TerminalHumanCollector({
      humanParticipantId: 'you',
      game: fakeGame(),
      fallback: new FakeFallback(),
      input: Readable.from([]), // ends immediately, before answering
      output: outputSink().output,
    });

    const result = await collector.requestAction(BASE_ARGS);

    expect(result).toEqual({ ok: false, reason: 'disconnected' });
  });

  it('throws a clear error if the game declares no humanInterface', async () => {
    const collector = new TerminalHumanCollector({
      humanParticipantId: 'you',
      game: fakeGame({ withHumanInterface: false }),
      fallback: new FakeFallback(),
      input: Readable.from([]),
      output: outputSink().output,
    });

    await expect(collector.requestAction(BASE_ARGS)).rejects.toThrow(/humanInterface/);
  });
});
