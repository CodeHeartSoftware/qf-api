import { compareResearchTimestamps, type ResearchTimestamp } from '../common/timestamps.js';
import type { ResearchId } from '../common/ids.js';
import { parseResearchDataset, type ResearchDataset } from '../dataset/dataset.js';
import type { ResearchRelationship } from '../relationship/relationship.js';
import type { ValidationIssue, ValidationResult } from './issue.js';

function idSet(items: readonly { id: ResearchId }[]): ReadonlySet<ResearchId> {
  return new Set(items.map((item) => item.id));
}

function timestampMap<T extends { id: ResearchId }>(
  items: readonly T[],
  getTimestamp: (item: T) => ResearchTimestamp,
): ReadonlyMap<ResearchId, ResearchTimestamp> {
  return new Map(items.map((item) => [item.id, getTimestamp(item)]));
}

/**
 * A relationship has no epistemic timestamp of its own (see `state/provider.ts`) — it becomes
 * knowable the moment its *earliest* state does. Used here as the relationship's own citing/cited
 * timestamp for temporal-integrity purposes. Never `undefined` in practice (`states` is a
 * non-empty array per `RelationshipSchema`), but written defensively rather than asserted.
 */
function earliestRelationshipTimestamp(
  relationship: ResearchRelationship,
): ResearchTimestamp | undefined {
  return relationship.states.reduce<ResearchTimestamp | undefined>(
    (earliest, state) =>
      earliest === undefined || compareResearchTimestamps(state.recordedAt, earliest) < 0
        ? state.recordedAt
        : earliest,
    undefined,
  );
}

/**
 * Every object with an `id` must be unique across the WHOLE dataset, not just within its own
 * collection (spec §6.1: "IDs must be stable and unique within a dataset").
 */
export function findDuplicateIds(dataset: ResearchDataset): ValidationIssue[] {
  const collections: { path: string; items: readonly { id: ResearchId }[] }[] = [
    { path: 'entities', items: dataset.entities },
    { path: 'relationships', items: dataset.relationships },
    { path: 'evidence', items: dataset.evidence },
    { path: 'assertions', items: dataset.assertions },
    { path: 'hypotheses', items: dataset.hypotheses },
    { path: 'assumptions', items: dataset.assumptions },
    { path: 'variables', items: dataset.variables },
    { path: 'models', items: dataset.models },
    { path: 'scenarios', items: dataset.scenarios },
    { path: 'events', items: dataset.events },
    { path: 'questions', items: dataset.questions },
  ];

  const firstSeenAt = new Map<ResearchId, string>();
  const issues: ValidationIssue[] = [];

  for (const { path, items } of collections) {
    items.forEach((item, index) => {
      const itemPath = `${path}.${String(index)}`;
      const existing = firstSeenAt.get(item.id);
      if (existing !== undefined) {
        issues.push({
          path: itemPath,
          code: 'duplicate-id',
          message: `id "${item.id}" at ${itemPath} was already used at ${existing} — ids must be unique across the whole dataset`,
        });
      } else {
        firstSeenAt.set(item.id, itemPath);
      }
    });
  }

  return issues;
}

function checkRefs(
  ids: readonly ResearchId[],
  validIds: ReadonlySet<ResearchId>,
  pathPrefix: string,
  targetLabel: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  ids.forEach((id, index) => {
    if (!validIds.has(id)) {
      const path = `${pathPrefix}.${String(index)}`;
      issues.push({
        path,
        code: 'missing-reference',
        message: `${path} references ${targetLabel} "${id}", which does not exist in the dataset`,
      });
    }
  });
  return issues;
}

function checkRef(
  id: ResearchId | undefined,
  validIds: ReadonlySet<ResearchId>,
  path: string,
  targetLabel: string,
): ValidationIssue[] {
  if (id === undefined || validIds.has(id)) return [];
  return [
    {
      path,
      code: 'missing-reference',
      message: `${path} references ${targetLabel} "${id}", which does not exist in the dataset`,
    },
  ];
}

/**
 * Every id-shaped reference in the dataset (relationship endpoints, evidence citations, model
 * variable/assumption references, scenario overrides, ...) must resolve to a real object
 * elsewhere in the same dataset (spec §33/§34).
 */
export function findMissingReferences(dataset: ResearchDataset): ValidationIssue[] {
  const entityIds = idSet(dataset.entities);
  const relationshipIds = idSet(dataset.relationships);
  const evidenceIds = idSet(dataset.evidence);
  const assumptionIds = idSet(dataset.assumptions);
  const variableIds = idSet(dataset.variables);
  const eventIds = idSet(dataset.events);
  const scenarioIds = idSet(dataset.scenarios);
  const hypothesisIds = idSet(dataset.hypotheses);

  const issues: ValidationIssue[] = [];

  dataset.relationships.forEach((relationship, rIndex) => {
    issues.push(
      ...checkRef(
        relationship.fromEntityId,
        entityIds,
        `relationships.${String(rIndex)}.fromEntityId`,
        'entity',
      ),
      ...checkRef(
        relationship.toEntityId,
        entityIds,
        `relationships.${String(rIndex)}.toEntityId`,
        'entity',
      ),
    );
    relationship.states.forEach((state, sIndex) => {
      issues.push(
        ...checkRefs(
          state.evidenceIds,
          evidenceIds,
          `relationships.${String(rIndex)}.states.${String(sIndex)}.evidenceIds`,
          'evidence',
        ),
      );
    });
  });

  dataset.evidence.forEach((evidence, index) => {
    issues.push(
      ...checkRefs(evidence.entityIds, entityIds, `evidence.${String(index)}.entityIds`, 'entity'),
    );
  });

  dataset.assertions.forEach((assertion, index) => {
    issues.push(
      ...checkRefs(
        assertion.evidenceIds,
        evidenceIds,
        `assertions.${String(index)}.evidenceIds`,
        'evidence',
      ),
      ...checkRefs(
        assertion.entityIds ?? [],
        entityIds,
        `assertions.${String(index)}.entityIds`,
        'entity',
      ),
      ...checkRefs(
        assertion.relationshipIds ?? [],
        relationshipIds,
        `assertions.${String(index)}.relationshipIds`,
        'relationship',
      ),
    );
  });

  dataset.hypotheses.forEach((hypothesis, hIndex) => {
    hypothesis.assessments.forEach((assessment, aIndex) => {
      const prefix = `hypotheses.${String(hIndex)}.assessments.${String(aIndex)}`;
      issues.push(
        ...checkRefs(
          assessment.supportingEvidenceIds,
          evidenceIds,
          `${prefix}.supportingEvidenceIds`,
          'evidence',
        ),
        ...checkRefs(
          assessment.contradictingEvidenceIds,
          evidenceIds,
          `${prefix}.contradictingEvidenceIds`,
          'evidence',
        ),
      );
    });
    (hypothesis.falsifiers ?? []).forEach((criterion, fIndex) => {
      issues.push(
        ...checkRefs(
          criterion.evidenceIds ?? [],
          evidenceIds,
          `hypotheses.${String(hIndex)}.falsifiers.${String(fIndex)}.evidenceIds`,
          'evidence',
        ),
      );
    });
  });

  dataset.models.forEach((model, mIndex) => {
    const prefix = `models.${String(mIndex)}`;
    issues.push(
      ...checkRefs(model.variableIds, variableIds, `${prefix}.variableIds`, 'variable'),
      ...checkRefs(model.assumptionIds, assumptionIds, `${prefix}.assumptionIds`, 'assumption'),
      ...checkRefs(model.outputVariableIds, variableIds, `${prefix}.outputVariableIds`, 'variable'),
      ...checkRefs(model.evidenceIds ?? [], evidenceIds, `${prefix}.evidenceIds`, 'evidence'),
    );
    model.calculations.forEach((calculation, cIndex) => {
      const calcPrefix = `${prefix}.calculations.${String(cIndex)}`;
      issues.push(
        ...checkRefs(
          calculation.inputVariableIds,
          variableIds,
          `${calcPrefix}.inputVariableIds`,
          'variable',
        ),
        ...checkRef(
          calculation.outputVariableId,
          variableIds,
          `${calcPrefix}.outputVariableId`,
          'variable',
        ),
        ...checkRefs(
          calculation.assumptionIds ?? [],
          assumptionIds,
          `${calcPrefix}.assumptionIds`,
          'assumption',
        ),
      );
    });
  });

  dataset.scenarios.forEach((scenario, index) => {
    const prefix = `scenarios.${String(index)}`;
    issues.push(
      ...checkRefs(scenario.assumptionIds, assumptionIds, `${prefix}.assumptionIds`, 'assumption'),
      ...checkRefs(scenario.eventIds, eventIds, `${prefix}.eventIds`, 'event'),
      ...checkRef(scenario.parentScenarioId, scenarioIds, `${prefix}.parentScenarioId`, 'scenario'),
    );
    for (const variableId of Object.keys(scenario.variableOverrides)) {
      if (!variableIds.has(variableId)) {
        const path = `${prefix}.variableOverrides.${variableId}`;
        issues.push({
          path,
          code: 'missing-reference',
          message: `${path} references variable "${variableId}", which does not exist in the dataset`,
        });
      }
    }
  });

  dataset.events.forEach((event, index) => {
    issues.push(
      ...checkRefs(event.entityIds, entityIds, `events.${String(index)}.entityIds`, 'entity'),
      ...checkRefs(
        event.evidenceIds,
        evidenceIds,
        `events.${String(index)}.evidenceIds`,
        'evidence',
      ),
    );
  });

  dataset.questions.forEach((question, index) => {
    const prefix = `questions.${String(index)}`;
    issues.push(
      ...checkRefs(
        question.relatedEntityIds ?? [],
        entityIds,
        `${prefix}.relatedEntityIds`,
        'entity',
      ),
      ...checkRefs(
        question.relatedHypothesisIds ?? [],
        hypothesisIds,
        `${prefix}.relatedHypothesisIds`,
        'hypothesis',
      ),
    );
  });

  return issues;
}

function checkTemporalRefs(
  citingTimestamp: ResearchTimestamp,
  ids: readonly ResearchId[],
  targetTimestamps: ReadonlyMap<ResearchId, ResearchTimestamp>,
  pathPrefix: string,
  targetLabel: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  ids.forEach((id, index) => {
    const targetTimestamp = targetTimestamps.get(id);
    // A missing id is `findMissingReferences`'s concern, not this check's — nothing to compare.
    if (targetTimestamp === undefined) return;
    if (compareResearchTimestamps(targetTimestamp, citingTimestamp) > 0) {
      const path = `${pathPrefix}.${String(index)}`;
      issues.push({
        path,
        code: 'temporal-integrity-violation',
        message: `${path} references ${targetLabel} "${id}", which was not knowable until ${targetTimestamp} — after this reference's own timestamp ${citingTimestamp}`,
      });
    }
  });
  return issues;
}

function checkTemporalRef(
  citingTimestamp: ResearchTimestamp,
  id: ResearchId | undefined,
  targetTimestamps: ReadonlyMap<ResearchId, ResearchTimestamp>,
  path: string,
  targetLabel: string,
): ValidationIssue[] {
  if (id === undefined) return [];
  const targetTimestamp = targetTimestamps.get(id);
  if (
    targetTimestamp === undefined ||
    compareResearchTimestamps(targetTimestamp, citingTimestamp) <= 0
  ) {
    return [];
  }
  return [
    {
      path,
      code: 'temporal-integrity-violation',
      message: `${path} references ${targetLabel} "${id}", which was not knowable until ${targetTimestamp} — after this reference's own timestamp ${citingTimestamp}`,
    },
  ];
}

/**
 * Every id-shaped reference must not just resolve (see `findMissingReferences`), but resolve to
 * something that was *already knowable* at the citing object's own epistemic timestamp — you
 * cannot cite evidence you don't have yet, or an entity research hadn't recorded yet. This was
 * previously an unvalidated assumption (see `state/provider.ts`'s `computeResearchStateAt`
 * docstring); this closes that gap so a well-formed dataset can never produce a point-in-time
 * snapshot with a reference that only makes sense in hindsight.
 *
 * Each collection's own epistemic timestamp is the same one `computeResearchStateAt` gates
 * visibility by (see that function's doc table), with two exceptions that have no per-object
 * timestamp to check *against* themselves: a relationship's `falsifiers` and a model's
 * `calculations` are checked against their parent's own timestamp (`hypothesis.createdAt` /
 * `model.createdAt`), since neither carries an independent timestamp of its own.
 */
export function findTemporalIntegrityViolations(dataset: ResearchDataset): ValidationIssue[] {
  const entityTimestamps = timestampMap(dataset.entities, (e) => e.recordedAt);
  const evidenceTimestamps = timestampMap(dataset.evidence, (e) => e.observedAt);
  const assumptionTimestamps = timestampMap(dataset.assumptions, (a) => a.recordedAt);
  const variableTimestamps = timestampMap(dataset.variables, (v) => v.recordedAt);
  const eventTimestamps = timestampMap(dataset.events, (e) => e.timestamp);
  const scenarioTimestamps = timestampMap(dataset.scenarios, (s) => s.recordedAt);
  const hypothesisTimestamps = timestampMap(dataset.hypotheses, (h) => h.createdAt);
  const relationshipTimestamps = new Map(
    dataset.relationships
      .map(
        (relationship) => [relationship.id, earliestRelationshipTimestamp(relationship)] as const,
      )
      .filter((entry): entry is [ResearchId, ResearchTimestamp] => entry[1] !== undefined),
  );

  const issues: ValidationIssue[] = [];

  dataset.relationships.forEach((relationship, rIndex) => {
    const relationshipTimestamp = relationshipTimestamps.get(relationship.id);
    if (relationshipTimestamp === undefined) return;
    issues.push(
      ...checkTemporalRef(
        relationshipTimestamp,
        relationship.fromEntityId,
        entityTimestamps,
        `relationships.${String(rIndex)}.fromEntityId`,
        'entity',
      ),
      ...checkTemporalRef(
        relationshipTimestamp,
        relationship.toEntityId,
        entityTimestamps,
        `relationships.${String(rIndex)}.toEntityId`,
        'entity',
      ),
    );
    relationship.states.forEach((state, sIndex) => {
      issues.push(
        ...checkTemporalRefs(
          state.recordedAt,
          state.evidenceIds,
          evidenceTimestamps,
          `relationships.${String(rIndex)}.states.${String(sIndex)}.evidenceIds`,
          'evidence',
        ),
      );
    });
  });

  dataset.evidence.forEach((evidence, index) => {
    issues.push(
      ...checkTemporalRefs(
        evidence.observedAt,
        evidence.entityIds,
        entityTimestamps,
        `evidence.${String(index)}.entityIds`,
        'entity',
      ),
    );
  });

  dataset.assertions.forEach((assertion, index) => {
    issues.push(
      ...checkTemporalRefs(
        assertion.createdAt,
        assertion.evidenceIds,
        evidenceTimestamps,
        `assertions.${String(index)}.evidenceIds`,
        'evidence',
      ),
      ...checkTemporalRefs(
        assertion.createdAt,
        assertion.entityIds ?? [],
        entityTimestamps,
        `assertions.${String(index)}.entityIds`,
        'entity',
      ),
      ...checkTemporalRefs(
        assertion.createdAt,
        assertion.relationshipIds ?? [],
        relationshipTimestamps,
        `assertions.${String(index)}.relationshipIds`,
        'relationship',
      ),
    );
  });

  dataset.hypotheses.forEach((hypothesis, hIndex) => {
    hypothesis.assessments.forEach((assessment, aIndex) => {
      const prefix = `hypotheses.${String(hIndex)}.assessments.${String(aIndex)}`;
      issues.push(
        ...checkTemporalRefs(
          assessment.timestamp,
          assessment.supportingEvidenceIds,
          evidenceTimestamps,
          `${prefix}.supportingEvidenceIds`,
          'evidence',
        ),
        ...checkTemporalRefs(
          assessment.timestamp,
          assessment.contradictingEvidenceIds,
          evidenceTimestamps,
          `${prefix}.contradictingEvidenceIds`,
          'evidence',
        ),
      );
    });
    (hypothesis.falsifiers ?? []).forEach((criterion, fIndex) => {
      issues.push(
        ...checkTemporalRefs(
          hypothesis.createdAt,
          criterion.evidenceIds ?? [],
          evidenceTimestamps,
          `hypotheses.${String(hIndex)}.falsifiers.${String(fIndex)}.evidenceIds`,
          'evidence',
        ),
      );
    });
  });

  dataset.models.forEach((model, mIndex) => {
    const prefix = `models.${String(mIndex)}`;
    issues.push(
      ...checkTemporalRefs(
        model.createdAt,
        model.variableIds,
        variableTimestamps,
        `${prefix}.variableIds`,
        'variable',
      ),
      ...checkTemporalRefs(
        model.createdAt,
        model.assumptionIds,
        assumptionTimestamps,
        `${prefix}.assumptionIds`,
        'assumption',
      ),
      ...checkTemporalRefs(
        model.createdAt,
        model.outputVariableIds,
        variableTimestamps,
        `${prefix}.outputVariableIds`,
        'variable',
      ),
      ...checkTemporalRefs(
        model.createdAt,
        model.evidenceIds ?? [],
        evidenceTimestamps,
        `${prefix}.evidenceIds`,
        'evidence',
      ),
    );
    model.calculations.forEach((calculation, cIndex) => {
      const calcPrefix = `${prefix}.calculations.${String(cIndex)}`;
      issues.push(
        ...checkTemporalRefs(
          model.createdAt,
          calculation.inputVariableIds,
          variableTimestamps,
          `${calcPrefix}.inputVariableIds`,
          'variable',
        ),
        ...checkTemporalRef(
          model.createdAt,
          calculation.outputVariableId,
          variableTimestamps,
          `${calcPrefix}.outputVariableId`,
          'variable',
        ),
        ...checkTemporalRefs(
          model.createdAt,
          calculation.assumptionIds ?? [],
          assumptionTimestamps,
          `${calcPrefix}.assumptionIds`,
          'assumption',
        ),
      );
    });
  });

  dataset.scenarios.forEach((scenario, index) => {
    const prefix = `scenarios.${String(index)}`;
    issues.push(
      ...checkTemporalRefs(
        scenario.recordedAt,
        scenario.assumptionIds,
        assumptionTimestamps,
        `${prefix}.assumptionIds`,
        'assumption',
      ),
      ...checkTemporalRefs(
        scenario.recordedAt,
        scenario.eventIds,
        eventTimestamps,
        `${prefix}.eventIds`,
        'event',
      ),
      ...checkTemporalRef(
        scenario.recordedAt,
        scenario.parentScenarioId,
        scenarioTimestamps,
        `${prefix}.parentScenarioId`,
        'scenario',
      ),
    );
    for (const variableId of Object.keys(scenario.variableOverrides)) {
      issues.push(
        ...checkTemporalRef(
          scenario.recordedAt,
          variableId,
          variableTimestamps,
          `${prefix}.variableOverrides.${variableId}`,
          'variable',
        ),
      );
    }
  });

  dataset.events.forEach((event, index) => {
    issues.push(
      ...checkTemporalRefs(
        event.timestamp,
        event.entityIds,
        entityTimestamps,
        `events.${String(index)}.entityIds`,
        'entity',
      ),
      ...checkTemporalRefs(
        event.timestamp,
        event.evidenceIds,
        evidenceTimestamps,
        `events.${String(index)}.evidenceIds`,
        'evidence',
      ),
    );
  });

  dataset.questions.forEach((question, index) => {
    const prefix = `questions.${String(index)}`;
    issues.push(
      ...checkTemporalRefs(
        question.createdAt,
        question.relatedEntityIds ?? [],
        entityTimestamps,
        `${prefix}.relatedEntityIds`,
        'entity',
      ),
      ...checkTemporalRefs(
        question.createdAt,
        question.relatedHypothesisIds ?? [],
        hypothesisTimestamps,
        `${prefix}.relatedHypothesisIds`,
        'hypothesis',
      ),
    );
  });

  return issues;
}

/**
 * The single entry point for validating a research dataset: first the structural shape of
 * every nested object (temporal ordering, confidence bounds, etc. — via `parseResearchDataset`),
 * then dataset-wide invariants that require seeing every collection at once (duplicate ids,
 * missing references, temporal integrity). Cross-reference checks only run once the structural
 * parse succeeds, since they assume well-formed objects to look up ids on.
 */
export function validateResearchDataset(raw: unknown): ValidationResult<ResearchDataset> {
  const parsed = parseResearchDataset(raw);
  if (!parsed.ok) return parsed;

  const issues = [
    ...findDuplicateIds(parsed.value),
    ...findMissingReferences(parsed.value),
    ...findTemporalIntegrityViolations(parsed.value),
  ];
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return parsed;
}
