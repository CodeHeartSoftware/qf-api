import { z } from 'zod';

/** Split out from `hypothesis.ts` so `assessment.ts` can reference it too (a `HypothesisAssessment`
 * may now optionally record a status change alongside its confidence read — see that file's own
 * doc comment) without an import cycle between the two. */
export const HypothesisStatusSchema = z.enum([
  'proposed',
  'active',
  'supported',
  'weakened',
  'falsified',
  'accepted',
  'rejected',
  'retired',
]);

export type HypothesisStatus = z.infer<typeof HypothesisStatusSchema>;
