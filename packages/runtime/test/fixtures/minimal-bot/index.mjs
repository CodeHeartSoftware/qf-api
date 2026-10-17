#!/usr/bin/env node
// Minimal test bot for validating the runtime's Docker lifecycle end-to-end. This is
// a test fixture, not a competitive bot or an example for bot authors — it just speaks the
// protocol correctly: acknowledge init, echo back an action for any awaited observation, and
// exit cleanly on match-end.
import { createInterface } from 'node:readline';

let seq = 0;

function send(matchId, type, fields) {
  process.stdout.write(
    `${JSON.stringify({
      protocolVersion: '1.0',
      type,
      matchId,
      seq: seq++,
      sentAt: new Date().toISOString(),
      ...fields,
    })}\n`,
  );
}

const rl = createInterface({ input: process.stdin });

rl.on('line', (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }

  if (message.type === 'init') {
    send(message.matchId, 'ready', { payload: { protocolVersion: '1.0' } });
    return;
  }

  if (message.type === 'observation' && message.payload.awaitingAction) {
    send(message.matchId, 'action', {
      roundId: message.roundId,
      payload: { action: { echo: message.payload.state } },
    });
    return;
  }

  if (message.type === 'match-end') {
    process.exit(0);
  }
});
