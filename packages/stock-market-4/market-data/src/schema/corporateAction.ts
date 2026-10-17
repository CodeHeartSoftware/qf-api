import { z } from 'zod';
import { CalendarDateSchema } from './dailyBar.js';

/**
 * Field-for-field identical to `games/stock-market-4`'s own `CorporateActionSchema` —
 * reimplemented independently for the same reason `DailyBarSchema` is (see that file's doc
 * comment). Amounts are dollars, not cents, matching `DailyBar`.
 */
export const CORPORATE_ACTION_TYPES = [
  'CASH_DIVIDEND',
  'STOCK_SPLIT',
  'REVERSE_SPLIT',
  'BUYBACK',
  'ACQUISITION',
  'DELISTING',
] as const;
export type CorporateActionType = (typeof CORPORATE_ACTION_TYPES)[number];

const CorporateActionBaseFields = {
  ticker: z.string().min(1),
  date: CalendarDateSchema,
  /** ACQUISITION/DELISTING only in practice — see `games/stock-market-4`'s own doc comment on
   * this same field. Structurally allowed on every type for schema simplicity. */
  announcedDate: CalendarDateSchema.optional(),
};

const CorporateActionUnion = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('CASH_DIVIDEND'),
    ...CorporateActionBaseFields,
    perShare: z.number().positive(),
  }),
  z.object({
    type: z.literal('STOCK_SPLIT'),
    ...CorporateActionBaseFields,
    fromShares: z.number().int().positive(),
    toShares: z.number().int().positive(),
  }),
  z.object({
    type: z.literal('REVERSE_SPLIT'),
    ...CorporateActionBaseFields,
    fromShares: z.number().int().positive(),
    toShares: z.number().int().positive(),
  }),
  z.object({
    type: z.literal('BUYBACK'),
    ...CorporateActionBaseFields,
    sharesRepurchased: z.number().int().positive(),
  }),
  z.object({
    type: z.literal('ACQUISITION'),
    ...CorporateActionBaseFields,
    cashPerShare: z.number().positive(),
  }),
  z.object({
    type: z.literal('DELISTING'),
    ...CorporateActionBaseFields,
    reason: z.string().min(1),
  }),
]);

export const CorporateActionSchema = CorporateActionUnion.superRefine((action, ctx) => {
  if (action.announcedDate !== undefined && action.announcedDate > action.date) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['announcedDate'],
      message: 'announcedDate must be at or before date',
    });
  }
  if (action.type === 'STOCK_SPLIT' && action.toShares <= action.fromShares) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['toShares'],
      message: 'a STOCK_SPLIT must increase share count: toShares must be > fromShares',
    });
  }
  if (action.type === 'REVERSE_SPLIT' && action.fromShares <= action.toShares) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['toShares'],
      message: 'a REVERSE_SPLIT must decrease share count: fromShares must be > toShares',
    });
  }
});
export type CorporateAction = z.infer<typeof CorporateActionSchema>;
