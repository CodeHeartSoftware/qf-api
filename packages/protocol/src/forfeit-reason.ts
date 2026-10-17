import { z } from 'zod';

/**
 * Exhaustive failure-mode -> forfeit-reason taxonomy (docs/adr/0003-docker-bot-isolation.md).
 * Every non-completion match outcome maps to exactly one of these, so a bot's failure is always
 * explicit and attributable rather than an unstructured "something went wrong."
 */
export const FORFEIT_REASONS = [
  'BOT_CRASHED',
  'TURN_TIMEOUT',
  'MATCH_TIMEOUT',
  'PROTOCOL_VIOLATION',
  'ILLEGAL_ACTION',
  'RESOURCE_LIMIT_EXCEEDED',
  'ENGINE_ERROR',
  'RESIGNED',
  'INIT_TIMEOUT',
  'PROTOCOL_VERSION_UNSUPPORTED',
] as const;

export const ForfeitReasonSchema = z.enum(FORFEIT_REASONS);
export type ForfeitReason = z.infer<typeof ForfeitReasonSchema>;
