import { z } from 'zod';
import { ResearchIdSchema } from '../common/ids.js';
import { ResearchTimestampSchema } from '../common/timestamps.js';
import { ResearchValueSchema } from '../common/values.js';
import { fromZodSafeParse, type ValidationResult } from '../validation/issue.js';

export const RESEARCH_QUESTION_STATUSES = ['open', 'answered', 'retired'] as const;
export type ResearchQuestionStatus = (typeof RESEARCH_QUESTION_STATUSES)[number];

export const ResearchQuestionSchema = z
  .object({
    id: ResearchIdSchema,
    /** A short, human-friendly reference code (e.g. "RQ-ELMT-001") — domain-defined, purely for
     * cross-referencing in prose; `id` remains the actual dataset-unique identifier. */
    code: z.string().optional(),
    question: z.string().min(1, 'question must be a non-empty string'),
    status: z.enum(RESEARCH_QUESTION_STATUSES),
    // Visibility (state reconstruction): gated by createdAt.
    createdAt: ResearchTimestampSchema,
    relatedEntityIds: z.array(ResearchIdSchema).optional(),
    relatedHypothesisIds: z.array(ResearchIdSchema).optional(),
    metadata: z.record(ResearchValueSchema).optional(),
  })
  .strict();

/**
 * An open question the research doesn't yet answer — "what's the annual production capacity?",
 * not itself an evidence, assertion, or hypothesis. Kept distinct from `ResearchHypothesis`
 * (which is a testable BELIEF with a confidence value) because a question has no truth value to
 * assess: it's a research agenda item, not a claim. Domain-neutral — every research domain
 * accumulates open questions, not just this one.
 */
export type ResearchQuestion = z.infer<typeof ResearchQuestionSchema>;

export function parseResearchQuestion(raw: unknown): ValidationResult<ResearchQuestion> {
  return fromZodSafeParse(ResearchQuestionSchema.safeParse(raw));
}
