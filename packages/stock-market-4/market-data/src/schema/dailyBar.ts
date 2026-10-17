import { z } from 'zod';

/** An ISO calendar date (yyyy-mm-dd). Plain string comparison (`<`/`>=`) is chronologically
 * correct for these without parsing, since they're always zero-padded and in the same format —
 * the same convention every date-gated read in this package (and in `games/stock-market-4`,
 * independently) relies on. */
export type CalendarDate = string;

const CALENDAR_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
export const CalendarDateSchema = z
  .string()
  .regex(CALENDAR_DATE_REGEX, 'must be an ISO calendar date (yyyy-mm-dd)');

/**
 * One trading day's OHLCV bar. Field-for-field identical to `games/stock-market-4`'s own
 * `DailyBarSchema` — deliberately reimplemented rather than imported (this package has no
 * dependency on any game, the same one-way boundary `games/stock-market-4/src/types.ts` already
 * documents for its own `Security` type), but the identical shape means a game can pass this
 * package's `DailyBar[]` straight into its own existing point-in-time functions
 * (`historicalBarsAsOf`, `splitAdjustedBarsAsOf`, ...) with no adapter/mapping layer.
 */
export const DailyBarSchema = z
  .object({
    date: CalendarDateSchema,
    open: z.number().positive(),
    high: z.number().positive(),
    low: z.number().positive(),
    close: z.number().positive(),
    volume: z.number().nonnegative(),
  })
  .strict()
  .superRefine((bar, ctx) => {
    if (bar.high < bar.low) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['high'], message: 'high must be >= low' });
    }
    if (bar.high < bar.open || bar.high < bar.close) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['high'],
        message: 'high must be >= both open and close',
      });
    }
    if (bar.low > bar.open || bar.low > bar.close) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['low'],
        message: 'low must be <= both open and close',
      });
    }
  });
export type DailyBar = z.infer<typeof DailyBarSchema>;
