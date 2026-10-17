import { z } from 'zod';
import { ResearchIdSchema } from '../common/ids.js';
import { compareResearchTimestamps } from '../common/timestamps.js';
import { ResearchValueSchema } from '../common/values.js';
import {
  fromZodSafeParse,
  type ValidationIssue,
  type ValidationResult,
} from '../validation/issue.js';
import { RelationshipStateSchema, type RelationshipState } from './relationship-state.js';

const BaseResearchRelationshipSchema = z.object({
  id: ResearchIdSchema,
  // Domain-defined (e.g. "supplies", "depends_on", "competes_with") — research-core does not
  // enumerate relationship types; a domain package like research/fusion owns that vocabulary.
  type: z.string().min(1, 'relationship type must be a non-empty string'),
  fromEntityId: ResearchIdSchema,
  toEntityId: ResearchIdSchema,
  states: z.array(RelationshipStateSchema),
  metadata: z.record(ResearchValueSchema).optional(),
});

/**
 * A relationship's states describe its status over time and must not overlap: at most one
 * state is effective at any instant, so "what was this relationship's status at time T" has an
 * unambiguous answer. States are compared by `effectiveFrom`; only the chronologically last
 * state may be open-ended (no `effectiveTo`).
 */
export function findOverlappingRelationshipStates(
  states: readonly RelationshipState[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const sorted = states
    .map((state, index) => ({ state, index }))
    .sort((a, b) => compareResearchTimestamps(a.state.effectiveFrom, b.state.effectiveFrom));

  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i];
    const next = sorted[i + 1];
    if (!current || !next) continue; // unreachable given the loop bounds; satisfies noUncheckedIndexedAccess

    if (compareResearchTimestamps(current.state.effectiveFrom, next.state.effectiveFrom) === 0) {
      issues.push({
        path: `states.${String(current.index)}`,
        code: 'ambiguous-effective-from',
        message: `states.${String(current.index)} and states.${String(next.index)} share the same effectiveFrom (${current.state.effectiveFrom}) — ordering between them is ambiguous`,
      });
      continue;
    }

    if (current.state.effectiveTo === undefined) {
      issues.push({
        path: `states.${String(current.index)}`,
        code: 'open-ended-state-superseded',
        message: `states.${String(current.index)} has no effectiveTo but is followed by states.${String(next.index)} (effectiveFrom ${next.state.effectiveFrom}) — only the chronologically last state may be open-ended`,
      });
      continue;
    }

    if (compareResearchTimestamps(current.state.effectiveTo, next.state.effectiveFrom) > 0) {
      issues.push({
        path: `states.${String(current.index)}`,
        code: 'overlapping-relationship-states',
        message: `states.${String(current.index)} (effectiveTo ${current.state.effectiveTo}) overlaps states.${String(next.index)} (effectiveFrom ${next.state.effectiveFrom})`,
      });
    }
  }

  return issues;
}

export const ResearchRelationshipSchema = BaseResearchRelationshipSchema.strict().superRefine(
  (value, ctx) => {
    for (const issue of findOverlappingRelationshipStates(value.states)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [issue.path], message: issue.message });
    }
  },
);

/**
 * A first-class, typed connection between two entities, whose status can evolve over time via
 * `states` (see relationship-state.ts). research-core does not prescribe `type`/`status`
 * vocabularies — those are domain-defined.
 */
export type ResearchRelationship = z.infer<typeof ResearchRelationshipSchema>;

export function parseResearchRelationship(raw: unknown): ValidationResult<ResearchRelationship> {
  return fromZodSafeParse(ResearchRelationshipSchema.safeParse(raw));
}
