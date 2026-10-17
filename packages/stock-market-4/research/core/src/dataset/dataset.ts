import { z } from 'zod';
import { ResearchAssertionSchema } from '../assertion/assertion.js';
import { ResearchIdSchema } from '../common/ids.js';
import { ResearchTimestampSchema } from '../common/timestamps.js';
import { ResearchValueSchema } from '../common/values.js';
import { ResearchEntitySchema } from '../entity/entity.js';
import { ResearchEventSchema } from '../event/event.js';
import { EvidenceSchema } from '../evidence/evidence.js';
import { ResearchHypothesisSchema } from '../hypothesis/hypothesis.js';
import { ResearchAssumptionSchema } from '../model/assumption.js';
import { ResearchModelSchema } from '../model/model.js';
import { ResearchScenarioSchema } from '../model/scenario.js';
import { ResearchVariableSchema } from '../model/variable.js';
import { ResearchQuestionSchema } from '../question/question.js';
import { ResearchRelationshipSchema } from '../relationship/relationship.js';
import { fromZodSafeParse, type ValidationResult } from '../validation/issue.js';

export const ResearchDatasetSchema = z
  .object({
    id: ResearchIdSchema,
    name: z.string().min(1, 'dataset name must be a non-empty string'),
    // Free-form (e.g. "1.0.0" or "2026-03-01") — research-core does not mandate a versioning
    // scheme, only that a published version is treated as immutable (see README.md).
    version: z.string().min(1, 'dataset version must be a non-empty string'),
    // Domain-defined (e.g. "fusion", "quantum") — research-core does not enumerate domains.
    domain: z.string().min(1, 'dataset domain must be a non-empty string'),
    createdAt: ResearchTimestampSchema,
    entities: z.array(ResearchEntitySchema),
    relationships: z.array(ResearchRelationshipSchema),
    evidence: z.array(EvidenceSchema),
    assertions: z.array(ResearchAssertionSchema),
    hypotheses: z.array(ResearchHypothesisSchema),
    assumptions: z.array(ResearchAssumptionSchema),
    variables: z.array(ResearchVariableSchema),
    models: z.array(ResearchModelSchema),
    scenarios: z.array(ResearchScenarioSchema),
    events: z.array(ResearchEventSchema),
    questions: z.array(ResearchQuestionSchema),
    metadata: z.record(ResearchValueSchema).optional(),
  })
  .strict();

/**
 * An immutable, versioned collection of research. A published version must never be mutated in
 * place — a correction creates a new `ResearchDataset` with a new `version` (see README.md).
 *
 * This schema validates every nested object's own rules (temporal ordering, confidence bounds,
 * etc. — see each type's own module) but NOT cross-object references (e.g. whether a
 * relationship's `fromEntityId` actually names an entity in `entities`) or duplicate ids across
 * collections — those require the whole dataset at once and are checked by
 * `validateResearchDataset` (see validation/dataset.ts).
 */
export type ResearchDataset = z.infer<typeof ResearchDatasetSchema>;

export function parseResearchDataset(raw: unknown): ValidationResult<ResearchDataset> {
  return fromZodSafeParse(ResearchDatasetSchema.safeParse(raw));
}
