import { describe, expect, it } from 'vitest';
import type { ResearchRelationship } from '@quant-fusion/research-core';
import { createFusionFixtureDataset } from '../src/index.js';
import {
  isPortfolioEntity,
  isPortfolioEvidence,
  isPortfolioRelationship,
  partitionDatasetByScope,
  PORTFOLIO_ENTITY_IDS,
} from '../src/scope.js';

function requireRelationship(
  relationships: readonly ResearchRelationship[],
  id: string,
): ResearchRelationship {
  const found = relationships.find((r) => r.id === id);
  if (found === undefined)
    throw new Error(`expected relationship "${id}" to exist in the fixture dataset`);
  return found;
}

describe('scope', () => {
  const dataset = createFusionFixtureDataset();

  it('has exactly the 11 tracked-security entity ids', () => {
    expect(PORTFOLIO_ENTITY_IDS.size).toBe(11);
    for (const id of PORTFOLIO_ENTITY_IDS) {
      expect(dataset.entities.some((entity) => entity.id === id)).toBe(true);
    }
  });

  it('classifies a real ecosystem-only relationship (Walter Tosto <-> SPARC) as non-portfolio', () => {
    const relationship = requireRelationship(dataset.relationships, 'rel-walter-tosto-sparc');
    expect(isPortfolioRelationship(relationship)).toBe(false);
  });

  it('classifies a real portfolio relationship (Freemelt <-> JT-60SA) as portfolio', () => {
    const relationship = requireRelationship(dataset.relationships, 'rel-freemelt-jt60sa');
    expect(isPortfolioRelationship(relationship)).toBe(true);
  });

  it('does not confuse a similarly-named unrelated entity for a tracked one', () => {
    // A.L.M.T. (a Japanese tungsten-monoblock manufacturer) is NOT Almonty Industries (ALM) —
    // see portfolio-research-update-skill.md's own warning about this exact mix-up.
    expect(isPortfolioEntity('entity-almt')).toBe(false);
    expect(isPortfolioEntity('entity-almonty')).toBe(true);
  });

  it('partitionDatasetByScope splits entities/relationships/evidence/events without loss or duplication', () => {
    const { portfolio, ecosystem } = partitionDatasetByScope(dataset);

    expect(portfolio.entities.length + ecosystem.entities.length).toBe(dataset.entities.length);
    expect(portfolio.relationships.length + ecosystem.relationships.length).toBe(
      dataset.relationships.length,
    );
    expect(portfolio.evidence.length + ecosystem.evidence.length).toBe(dataset.evidence.length);
    expect(portfolio.events.length + ecosystem.events.length).toBe(dataset.events.length);

    for (const entity of portfolio.entities) {
      expect(isPortfolioEntity(entity.id)).toBe(true);
    }
    for (const entity of ecosystem.entities) {
      expect(isPortfolioEntity(entity.id)).toBe(false);
    }
  });

  it('passes cross-cutting analytical collections through to BOTH partitions unchanged', () => {
    const { portfolio, ecosystem } = partitionDatasetByScope(dataset);
    for (const key of [
      'assertions',
      'hypotheses',
      'assumptions',
      'variables',
      'models',
      'scenarios',
      'questions',
    ] as const) {
      expect(portfolio[key]).toEqual(dataset[key]);
      expect(ecosystem[key]).toEqual(dataset[key]);
    }
  });

  it('isPortfolioEvidence is true whenever ANY cited entity is tracked, not just the first', () => {
    const mixedEvidence = { entityIds: ['entity-cfs', 'entity-elmt'] };
    expect(isPortfolioEvidence(mixedEvidence)).toBe(true);
    const ecosystemOnlyEvidence = { entityIds: ['entity-cfs', 'entity-iter'] };
    expect(isPortfolioEvidence(ecosystemOnlyEvidence)).toBe(false);
  });
});
