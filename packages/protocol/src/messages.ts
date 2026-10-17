import { z } from 'zod';
import { ForfeitReasonSchema } from './forfeit-reason.js';

/**
 * The universal bot protocol (docs/adr/0002-universal-bot-protocol.md). Every message is one
 * envelope, encoded as a single NDJSON line (see codec.ts / ndjson.ts). Message nouns are
 * generic (match/participant/round/observation/action/result/error) — nothing here is
 * game-specific; payload contents that ARE game-specific (`state`, `action`, `config`,
 * `outcome`) are deliberately `z.unknown()` and validated by the game layer instead.
 *
 * Schemas are intentionally not `.strict()`: an older engine/bot build must silently ignore
 * fields introduced by a later additive MINOR version rather than reject the message outright
 * (Zod's default object behavior — strip unknown keys rather than error — is exactly this).
 */

export const ProtocolVersionSchema = z
  .string()
  .regex(/^\d+\.\d+$/, 'protocolVersion must be MAJOR.MINOR');

const IsoDateTimeSchema = z
  .string()
  .datetime({ offset: true, message: 'must be an ISO-8601 datetime string' });

const NonEmptyStringSchema = z.string().min(1);
const NonNegativeIntSchema = z.number().int().nonnegative();

const BaseEnvelopeFields = {
  protocolVersion: ProtocolVersionSchema,
  matchId: NonEmptyStringSchema,
  seq: NonNegativeIntSchema,
  sentAt: IsoDateTimeSchema,
};
const BaseEnvelope = z.object(BaseEnvelopeFields);

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

export const InitPayloadSchema = z.object({
  gameId: NonEmptyStringSchema,
  gameVersion: NonEmptyStringSchema,
  participantId: NonEmptyStringSchema,
  // Every participantId in the match, including this recipient's own. Simplified from the
  // architecture sketch's `{ participantId }[]` — a plain id list carries the same information
  // with one less layer of indirection.
  roster: z.array(NonEmptyStringSchema).min(1),
  // This participant's own derived seed (docs/adr/0004-deterministic-randomness.md) — never
  // another participant's, never the engine's internal matchSeed.
  rngSeed: NonEmptyStringSchema,
  config: z.unknown(),
  matchDeadlineAt: IsoDateTimeSchema.optional(),
});

export const ReadyPayloadSchema = z.object({
  protocolVersion: ProtocolVersionSchema,
});

export const ObservationPayloadSchema = z.object({
  state: z.unknown(),
  awaitingAction: z.boolean(),
  deadlineAt: IsoDateTimeSchema.optional(),
});

export const ActionPayloadSchema = z.object({
  action: z.unknown(),
});

export const ResultPayloadSchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('round'), outcome: z.unknown() }),
  z.object({ scope: z.literal('match'), outcome: z.unknown() }),
]);

export const ResignPayloadSchema = z.object({
  note: z.string().optional(),
});

export const ErrorPayloadSchema = z
  .object({
    // Present when the engine is reporting a forfeit; a bot self-reporting its own internal
    // fault may omit it and rely on `detail` alone.
    reason: ForfeitReasonSchema.optional(),
    detail: z.string().optional(),
  })
  .refine((payload) => payload.reason !== undefined || payload.detail !== undefined, {
    message: 'error payload must include at least one of "reason" or "detail"',
  });

export const MatchEndPayloadSchema = z.object({
  result: z.unknown(),
  /** `'suspended'` (roadmap Phase 3 — see docs/adr/0013-forward-match-persistence.md): a
   * `match forward run` invocation ending because it ran out of currently-available data, not
   * because the match is actually over — distinct from `'aborted'` (something went wrong) and
   * `'completed'` (genuinely done). A bot doesn't need to treat this specially: `bot-sdk-js`'s
   * `runBot()` exits cleanly on any `match-end` regardless of `reason` — this exists purely so the
   * signal a bot (or a human reading logs) receives is honest about why the process is exiting. */
  reason: z.enum(['completed', 'aborted', 'suspended']),
});

// ---------------------------------------------------------------------------
// Messages (envelope + payload per type)
// ---------------------------------------------------------------------------

const InitMessageSchema = BaseEnvelope.extend({
  type: z.literal('init'),
  payload: InitPayloadSchema,
});

const ReadyMessageSchema = BaseEnvelope.extend({
  type: z.literal('ready'),
  payload: ReadyPayloadSchema,
});

const ObservationMessageSchema = BaseEnvelope.extend({
  type: z.literal('observation'),
  roundId: NonNegativeIntSchema,
  payload: ObservationPayloadSchema,
});

const ActionMessageSchema = BaseEnvelope.extend({
  type: z.literal('action'),
  roundId: NonNegativeIntSchema,
  payload: ActionPayloadSchema,
});

const ResultMessageSchema = BaseEnvelope.extend({
  type: z.literal('result'),
  roundId: NonNegativeIntSchema.optional(),
  payload: ResultPayloadSchema,
});

const ResignMessageSchema = BaseEnvelope.extend({
  type: z.literal('resign'),
  roundId: NonNegativeIntSchema.optional(),
  payload: ResignPayloadSchema,
});

const ErrorMessageSchema = BaseEnvelope.extend({
  type: z.literal('error'),
  roundId: NonNegativeIntSchema.optional(),
  payload: ErrorPayloadSchema,
});

const MatchEndMessageSchema = BaseEnvelope.extend({
  type: z.literal('match-end'),
  payload: MatchEndPayloadSchema,
});

export const ProtocolMessageSchema = z
  .discriminatedUnion('type', [
    InitMessageSchema,
    ReadyMessageSchema,
    ObservationMessageSchema,
    ActionMessageSchema,
    ResultMessageSchema,
    ResignMessageSchema,
    ErrorMessageSchema,
    MatchEndMessageSchema,
  ])
  .superRefine((message, ctx) => {
    // roundId <-> result.scope is a cross-field constraint discriminatedUnion can't express on
    // its own: a round-scoped result must correlate to a round; a match-scoped one must not.
    if (message.type !== 'result') {
      return;
    }
    if (message.payload.scope === 'round' && message.roundId === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'result messages with scope "round" must include roundId',
        path: ['roundId'],
      });
    }
    if (message.payload.scope === 'match' && message.roundId !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'result messages with scope "match" must not include roundId',
        path: ['roundId'],
      });
    }
  });

export type ProtocolMessage = z.infer<typeof ProtocolMessageSchema>;
export type InitMessage = z.infer<typeof InitMessageSchema>;
export type ReadyMessage = z.infer<typeof ReadyMessageSchema>;
export type ObservationMessage = z.infer<typeof ObservationMessageSchema>;
export type ActionMessage = z.infer<typeof ActionMessageSchema>;
export type ResultMessage = z.infer<typeof ResultMessageSchema>;
export type ResignMessage = z.infer<typeof ResignMessageSchema>;
export type ErrorMessage = z.infer<typeof ErrorMessageSchema>;
export type MatchEndMessage = z.infer<typeof MatchEndMessageSchema>;

export const MESSAGE_TYPES = [
  'init',
  'ready',
  'observation',
  'action',
  'result',
  'resign',
  'error',
  'match-end',
] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];
