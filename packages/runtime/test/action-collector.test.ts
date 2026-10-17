import { describe, expect, it } from 'vitest';
import { CURRENT_PROTOCOL_VERSION } from '@quant-fusion/protocol';
import { DockerActionCollector } from '../src/action-collector.js';
import { BotLifecycle } from '../src/lifecycle.js';
import { FakeBotProcess } from './fixtures/fake-bot-process.js';

const MATCH_ID = 'match-001';

function readyMessage(seq: number): unknown {
  return {
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    type: 'ready',
    matchId: MATCH_ID,
    seq,
    sentAt: '2026-01-01T00:00:00.000Z',
    payload: { protocolVersion: CURRENT_PROTOCOL_VERSION },
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

async function newRunningLifecycle(
  participantId: string,
): Promise<{ lifecycle: BotLifecycle; process: FakeBotProcess }> {
  const process = new FakeBotProcess(participantId);
  const lifecycle = new BotLifecycle({ process, matchId: MATCH_ID });
  const promise = lifecycle.initialize(
    {
      gameId: 'rps',
      gameVersion: '1.0.0',
      participantId,
      roster: ['p1', 'p2'],
      rngSeed: 'x',
      config: {},
    },
    { initTimeoutMs: 1000 },
  );
  process.emitMessage(readyMessage(0));
  await promise;
  return { lifecycle, process };
}

describe('DockerActionCollector', () => {
  it('sends the observation and returns the action once the bot replies', async () => {
    const { lifecycle, process } = await newRunningLifecycle('p1');
    const collector = new DockerActionCollector(new Map([['p1', lifecycle]]));

    const promise = collector.requestAction({
      participantId: 'p1',
      roundId: 0,
      observation: { round: 0 },
      deadlineMs: 1000,
      required: true,
    });
    process.emitMessage(actionMessage(1, 0, { choice: 'rock' }));
    const collected = await promise;

    expect(collected).toEqual({ ok: true, action: { choice: 'rock' } });
    expect(process.lastSentMessage).toMatchObject({
      type: 'observation',
      roundId: 0,
      payload: { state: { round: 0 }, awaitingAction: true },
    });
  });

  it('sends awaitingAction:false and returns without waiting when not required', async () => {
    const { lifecycle, process } = await newRunningLifecycle('p1');
    const collector = new DockerActionCollector(new Map([['p1', lifecycle]]));

    const collected = await collector.requestAction({
      participantId: 'p1',
      roundId: 0,
      observation: { round: 0 },
      deadlineMs: 1000,
      required: false,
    });

    expect(collected).toEqual({ ok: false, reason: 'timeout' });
    expect(process.lastSentMessage).toMatchObject({ payload: { awaitingAction: false } });
  });

  it('maps a TURN_TIMEOUT forfeit to a "timeout" collection reason', async () => {
    const { lifecycle } = await newRunningLifecycle('p1');
    const collector = new DockerActionCollector(new Map([['p1', lifecycle]]));

    const collected = await collector.requestAction({
      participantId: 'p1',
      roundId: 0,
      observation: {},
      deadlineMs: 5,
      required: true,
    });

    expect(collected).toEqual({ ok: false, reason: 'timeout' });
  });

  it('maps a PROTOCOL_VIOLATION forfeit to an "invalid" collection reason', async () => {
    const { lifecycle, process } = await newRunningLifecycle('p1');
    const collector = new DockerActionCollector(new Map([['p1', lifecycle]]));

    const promise = collector.requestAction({
      participantId: 'p1',
      roundId: 0,
      observation: {},
      deadlineMs: 1000,
      required: true,
    });
    process.emitMessage(actionMessage(1, 999, { choice: 'rock' })); // wrong roundId
    const collected = await promise;

    expect(collected).toEqual({ ok: false, reason: 'invalid' });
  });

  it('maps a BOT_CRASHED forfeit (unexpected exit) to a "disconnected" collection reason', async () => {
    const { lifecycle, process } = await newRunningLifecycle('p1');
    const collector = new DockerActionCollector(new Map([['p1', lifecycle]]));

    const promise = collector.requestAction({
      participantId: 'p1',
      roundId: 0,
      observation: {},
      deadlineMs: 1000,
      required: true,
    });
    process.emitExit({ code: 1, signal: null, oomKilled: false });
    const collected = await promise;

    expect(collected).toEqual({ ok: false, reason: 'disconnected' });
  });

  it('throws for a participantId with no registered lifecycle', async () => {
    const collector = new DockerActionCollector(new Map());

    await expect(
      collector.requestAction({
        participantId: 'unknown',
        roundId: 0,
        observation: {},
        deadlineMs: 1000,
        required: true,
      }),
    ).rejects.toThrow('no BotLifecycle registered for participant "unknown"');
  });
});
