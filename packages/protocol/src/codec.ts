import { ProtocolMessageSchema, type ProtocolMessage } from './messages.js';

/**
 * Malformed or invalid bot messages must cause a controlled forfeit, never an engine crash
 * (docs/adr/0002-universal-bot-protocol.md) — so decoding never throws. Callers pattern-match
 * on `ok` and map a failure to PROTOCOL_VIOLATION, matching the `Result<T>` idiom used
 * throughout the platform (e.g. GameDefinition.parseConfig).
 */
export type DecodeResult = { ok: true; message: ProtocolMessage } | { ok: false; reason: string };

export function encodeMessage(message: ProtocolMessage): string {
  return `${JSON.stringify(message)}\n`;
}

export function decodeMessage(line: string): DecodeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { ok: false, reason: 'line is not valid JSON' };
  }

  const result = ProtocolMessageSchema.safeParse(parsed);
  if (!result.success) {
    const reason = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    return { ok: false, reason };
  }

  return { ok: true, message: result.data };
}
