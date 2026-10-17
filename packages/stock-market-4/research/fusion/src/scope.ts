import { PORTFOLIO_ENTITY_IDS } from '@quant-fusion/fusion-universe';
import type {
  Evidence,
  ResearchDataset,
  ResearchEvent,
  ResearchRelationship,
} from '@quant-fusion/research-core';

// The 11 tracked-security entity ids now live in `@quant-fusion/fusion-universe` — the shared
// source of truth between this package and `@quant-fusion/market-data` (which needs the same 11
// companies' ticker/Yahoo-symbol/currency data). Re-exported here so existing importers of
// `@quant-fusion/research-fusion`'s `PORTFOLIO_ENTITY_IDS` don't need to change.
export { PORTFOLIO_ENTITY_IDS };

export function isPortfolioEntity(entityId: string): boolean {
  return PORTFOLIO_ENTITY_IDS.has(entityId);
}

/**
 * Scope is DERIVED from a record's own entity references, never stored on the record itself —
 * so it can never go stale as new relationships get added, and requires no migration of existing
 * data. A record is "portfolio" scope if it names at least one of the 11 tracked companies as a
 * direct party; everything else is "ecosystem" scope (see research-fusion's README).
 */
export function isPortfolioEvidence(evidence: Pick<Evidence, 'entityIds'>): boolean {
  return evidence.entityIds.some(isPortfolioEntity);
}

export function isPortfolioEvent(event: Pick<ResearchEvent, 'entityIds'>): boolean {
  return event.entityIds.some(isPortfolioEntity);
}

export function isPortfolioRelationship(
  relationship: Pick<ResearchRelationship, 'fromEntityId' | 'toEntityId'>,
): boolean {
  return isPortfolioEntity(relationship.fromEntityId) || isPortfolioEntity(relationship.toEntityId);
}

export interface ScopePartition {
  portfolio: ResearchDataset;
  ecosystem: ResearchDataset;
}

/**
 * Splits `dataset`'s entities/relationships/evidence/events into portfolio vs ecosystem scope —
 * a reporting/query convenience, never how the dataset is actually stored or fed to a match (both
 * `fixture.ts` and every bot consume the whole connected graph; see the README's "Two research
 * layers" section for why). Cross-cutting analytical collections (assertions, hypotheses, models,
 * scenarios, questions, variables, assumptions) aren't entity-scoped in the schema itself, so they
 * pass through to BOTH partitions unchanged rather than being arbitrarily split.
 */
export function partitionDatasetByScope(dataset: ResearchDataset): ScopePartition {
  const portfolioEntityIds = new Set(
    dataset.entities.filter((entity) => isPortfolioEntity(entity.id)).map((entity) => entity.id),
  );
  const relationshipTouchesPortfolio = (relationship: ResearchRelationship): boolean =>
    portfolioEntityIds.has(relationship.fromEntityId) ||
    portfolioEntityIds.has(relationship.toEntityId);

  // assertions/hypotheses/assumptions/variables/models/scenarios/questions aren't entity-scoped
  // in the schema itself, so `...dataset` carries them through to BOTH partitions unchanged.
  return {
    portfolio: {
      ...dataset,
      entities: dataset.entities.filter((entity) => isPortfolioEntity(entity.id)),
      relationships: dataset.relationships.filter(relationshipTouchesPortfolio),
      evidence: dataset.evidence.filter(isPortfolioEvidence),
      events: dataset.events.filter(isPortfolioEvent),
    },
    ecosystem: {
      ...dataset,
      entities: dataset.entities.filter((entity) => !isPortfolioEntity(entity.id)),
      relationships: dataset.relationships.filter((r) => !relationshipTouchesPortfolio(r)),
      evidence: dataset.evidence.filter((e) => !isPortfolioEvidence(e)),
      events: dataset.events.filter((e) => !isPortfolioEvent(e)),
    },
  };
}
