import { z } from 'zod';
import { ResearchAssertionSchema } from '../assertion/assertion.js';
import { ResearchTimestampSchema } from '../common/timestamps.js';
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

export const ResearchStateSchema = z
  .object({
    timestamp: ResearchTimestampSchema,
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
  })
  .strict();

/**
 * What the research system knew/believed as of `timestamp` — never "what is true", which is a
 * world-state concept this package deliberately has no access to. See `provider.ts` for how
 * this is reconstructed from a `ResearchDataset`, and the package README for the precise
 * timestamp that gates each collection's visibility.
 */
export type ResearchState = z.infer<typeof ResearchStateSchema>;

export function parseResearchState(raw: unknown): ValidationResult<ResearchState> {
  return fromZodSafeParse(ResearchStateSchema.safeParse(raw));
}
