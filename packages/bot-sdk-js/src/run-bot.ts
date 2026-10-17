// A game-agnostic Quant Fusion bot protocol client. See
// docs/adr/0002-universal-bot-protocol.md for the wire format this implements, and
// docs/guides/bot-author-guide.md for a walkthrough of using it from a real bot.
//
// This module owns the NDJSON-over-stdio plumbing (parsing inbound messages, replying to
// "init"/"observation", exiting on "match-end") that is identical for every bot regardless of
// game. A bot only supplies `decideAction` — everything else here is boilerplate a bot author
// should never need to read, let alone modify.
import { createInterface } from 'node:readline';

interface InitMessage {
  type: 'init';
  matchId: string;
  payload: { rngSeed: string; config: unknown };
}

interface ObservationMessage<TObservation> {
  type: 'observation';
  matchId: string;
  roundId: number;
  payload: { state: TObservation; awaitingAction: boolean };
}

interface MatchEndMessage {
  type: 'match-end';
  matchId: string;
}

/** Anything else (ready/action/result/resign/error) that a bot sends or never needs to parse. */
interface OtherMessage {
  type: string;
  matchId: string;
}

type InboundMessage<TObservation> =
  InitMessage | ObservationMessage<TObservation> | MatchEndMessage | OtherMessage;

export interface RunBotOptions<TObservation = unknown, TAction = unknown> {
  /** Called once per round this bot is expected to act; its return value is sent as the action. */
  decideAction: (observation: TObservation) => TAction;
  /** Called once, when "init" arrives — the right place to seed a bot's own PRNG from rngSeed. */
  onInit?: (init: { rngSeed: string; config: unknown }) => void;
  /** Defaults to '1.0'. Override only if a bot targets a different protocol version. */
  protocolVersion?: string;
  /** Defaults to process.stdin. Overridable for tests. */
  input?: NodeJS.ReadableStream;
  /** Defaults to process.stdout. Overridable for tests. */
  output?: NodeJS.WritableStream;
  /** Defaults to process.exit. Overridable for tests. */
  exit?: (code: number) => void;
}

/**
 * Runs a bot to completion: reads NDJSON messages from `input`, replies on `output`, and calls
 * `exit(0)` on "match-end". Blocks for the lifetime of the match — call this once, at the top
 * level of a bot's entry point, and do nothing else.
 */
export function runBot<TObservation = unknown, TAction = unknown>(
  options: RunBotOptions<TObservation, TAction>,
): void {
  const protocolVersion = options.protocolVersion ?? '1.0';
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const exit = options.exit ?? ((code: number) => process.exit(code));

  let outgoingSeq = 0;

  function send(matchId: string, type: string, fields: Record<string, unknown>): void {
    const envelope = {
      protocolVersion,
      type,
      matchId,
      seq: outgoingSeq++,
      sentAt: new Date().toISOString(),
      ...fields,
    };
    output.write(`${JSON.stringify(envelope)}\n`);
  }

  function isInboundMessage(value: unknown): value is InboundMessage<TObservation> {
    return typeof value === 'object' && value !== null && 'type' in value && 'matchId' in value;
  }

  // Explicit type predicates (rather than switching on `message.type` directly) so TypeScript
  // narrows fully to each concrete message shape — `OtherMessage.type` is a plain `string`, which
  // would otherwise stop the compiler from ruling it out just because `message.type === 'init'`.
  function isInit(message: InboundMessage<TObservation>): message is InitMessage {
    return message.type === 'init';
  }
  function isObservation(
    message: InboundMessage<TObservation>,
  ): message is ObservationMessage<TObservation> {
    return message.type === 'observation';
  }
  function isMatchEnd(message: InboundMessage<TObservation>): message is MatchEndMessage {
    return message.type === 'match-end';
  }

  const lines = createInterface({ input });

  lines.on('line', (line) => {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return; // malformed input from the engine isn't something a bot can usefully react to
    }
    if (!isInboundMessage(message)) {
      return;
    }

    // The engine just told us who we are, who our opponent is, and this match's rngSeed/config.
    // We must reply with "ready" before anything else happens.
    if (isInit(message)) {
      options.onInit?.(message.payload);
      send(message.matchId, 'ready', { payload: { protocolVersion } });
      return;
    }

    // Every round, every participant that could plausibly need to act receives one of these.
    // `awaitingAction` tells us whether a reply is actually expected this round.
    if (isObservation(message)) {
      if (!message.payload.awaitingAction) {
        return;
      }
      const action = options.decideAction(message.payload.state);
      send(message.matchId, 'action', { roundId: message.roundId, payload: { action } });
      return;
    }

    // The match is over — exit promptly. The runtime will forcibly tear down our container
    // shortly regardless, but a clean, fast exit is good practice.
    if (isMatchEnd(message)) {
      exit(0);
    }
  });
}
