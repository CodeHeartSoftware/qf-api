import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeResearchStore, createResearchStore, type ResearchStore } from '../../src/store/db.js';
import { getResearchDataset } from '../../src/store/read.js';
import { renderSeedSql, renderUpdateSql } from '../../src/store/sqlGen.js';
import { richDataset } from '../fixtures/richDataset.js';

let dir: string;
let store: ResearchStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'research-store-seed-test-'));
  store = createResearchStore(join(dir, 'fusion.sqlite'));
});

afterEach(() => {
  closeResearchStore(store);
  rmSync(dir, { recursive: true, force: true });
});

describe('renderSeedSql / getResearchDataset', () => {
  it('round-trips a full dataset with byte-for-byte semantic equality', () => {
    const dataset = richDataset();
    const rendered = renderSeedSql(dataset);
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    store.db.exec(rendered.value);

    const result = getResearchDataset(store, dataset.id);
    expect(result).toEqual({ ok: true, value: dataset });
  });

  it('refuses to render SQL for an invalid dataset', () => {
    const dataset = richDataset();
    const invalid = {
      ...dataset,
      events: [{ ...dataset.events[0], entityIds: ['no-such-entity'] }],
    };

    const rendered = renderSeedSql(invalid as typeof dataset);
    expect(rendered.ok).toBe(false);
  });

  it('returns not-found for a dataset that was never seeded', () => {
    const result = getResearchDataset(store, 'nope');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('not found');
  });

  it('keeps two seeded dataset ids fully isolated from each other', () => {
    const a = richDataset('dataset-a');
    const b = richDataset('dataset-b');
    const renderedA = renderSeedSql(a);
    const renderedB = renderSeedSql(b);
    expect(renderedA.ok && renderedB.ok).toBe(true);
    if (!renderedA.ok || !renderedB.ok) return;
    store.db.exec(renderedA.value);
    store.db.exec(renderedB.value);

    expect(getResearchDataset(store, 'dataset-a')).toEqual({ ok: true, value: a });
    expect(getResearchDataset(store, 'dataset-b')).toEqual({ ok: true, value: b });
  });
});

describe('renderUpdateSql', () => {
  function seed(dataset = richDataset()): typeof dataset {
    const rendered = renderSeedSql(dataset);
    if (!rendered.ok) throw new Error(rendered.reason);
    store.db.exec(rendered.value);
    return dataset;
  }

  it('appends new entities without disturbing existing rows', () => {
    const dataset = seed();
    const newEntity = {
      id: 'entity-new-supplier',
      type: 'company',
      name: 'New Supplier Inc.',
      recordedAt: '2026-02-01T00:00:00Z',
    };

    const rendered = renderUpdateSql(dataset, { entities: [newEntity] }, '2026-02-01T00:00:00Z');
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    store.db.exec(rendered.value.sql);

    const result = getResearchDataset(store, dataset.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.entities).toHaveLength(dataset.entities.length + 1);
    expect(result.value.entities.at(-1)).toEqual(newEntity);
    expect(result.value.version).toBe(rendered.value.newVersion);
    // Every previously-seeded entity is untouched.
    expect(result.value.entities.slice(0, -1)).toEqual(dataset.entities);
  });

  it('appends a new state to an existing relationship in place, without re-inserting it', () => {
    const dataset = seed();
    const existing = dataset.relationships[0];
    if (existing === undefined) throw new Error('fixture must have at least one relationship');

    const rendered = renderUpdateSql(
      dataset,
      {
        relationships: [
          {
            ...existing,
            states: [
              {
                status: 'production',
                recordedAt: '2026-06-01T00:00:00Z',
                effectiveFrom: '2026-06-01T00:00:00Z',
                evidenceIds: [],
              },
            ],
          },
        ],
      },
      '2026-06-01T00:00:00Z',
    );
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    store.db.exec(rendered.value.sql);

    const result = getResearchDataset(store, dataset.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.relationships).toHaveLength(dataset.relationships.length);
    expect(result.value.relationships[0]?.states).toHaveLength(existing.states.length + 1);
  });

  it('appends a new assessment to an existing hypothesis in place, without re-inserting it', () => {
    const dataset = seed();
    const existing = dataset.hypotheses[0];
    if (existing === undefined) throw new Error('fixture must have at least one hypothesis');

    const rendered = renderUpdateSql(
      dataset,
      {
        hypotheses: [
          {
            ...existing,
            status: 'falsified',
            assessments: [
              {
                timestamp: '2027-01-01T00:00:00Z',
                confidence: { value: 0.05 },
                supportingEvidenceIds: [],
                contradictingEvidenceIds: [],
                status: 'falsified',
              },
            ],
          },
        ],
      },
      '2027-01-01T00:00:00Z',
    );
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    store.db.exec(rendered.value.sql);

    const result = getResearchDataset(store, dataset.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.hypotheses).toHaveLength(dataset.hypotheses.length);
    const updated = result.value.hypotheses.find((h) => h.id === existing.id);
    expect(updated?.assessments).toHaveLength(existing.assessments.length + 1);
    expect(updated?.status).toBe('falsified');
  });

  it('refuses an update that collides with an existing id', () => {
    const dataset = seed();
    const existingEntity = dataset.entities[0];
    if (existingEntity === undefined) throw new Error('fixture must have at least one entity');

    const rendered = renderUpdateSql(
      dataset,
      { entities: [existingEntity] },
      '2026-02-01T00:00:00Z',
    );
    expect(rendered.ok).toBe(false);
  });

  it('refuses (and generates no migration) when a new relationship references an unknown entity id', () => {
    const dataset = seed();
    const rendered = renderUpdateSql(
      dataset,
      {
        relationships: [
          {
            id: 'rel-new-ghost',
            type: 'supplies',
            fromEntityId: 'entity-arc',
            toEntityId: 'entity-does-not-exist',
            states: [
              {
                status: 'qualification track',
                recordedAt: '2026-02-01T00:00:00Z',
                effectiveFrom: '2026-02-01T00:00:00Z',
                evidenceIds: [],
              },
            ],
          },
        ],
      },
      '2026-02-01T00:00:00Z',
    );
    expect(rendered.ok).toBe(false);
    if (!rendered.ok) {
      expect(rendered.reason).toContain('entity-does-not-exist');
      expect(rendered.reason).toContain('does not exist in the dataset');
    }
  });

  it('refuses when an appended relationship state would overlap an existing one', () => {
    const dataset = seed();
    const existing = dataset.relationships[0];
    if (existing === undefined) throw new Error('fixture must have at least one relationship');

    const rendered = renderUpdateSql(
      dataset,
      {
        relationships: [
          {
            ...existing,
            states: [
              {
                // Same effectiveFrom as the existing (still-open) last state -> ambiguous
                // ordering, refused by research-core's own findOverlappingRelationshipStates.
                status: 'production',
                recordedAt: '2026-06-01T00:00:00Z',
                effectiveFrom: '2025-01-01T00:00:00Z',
                evidenceIds: [],
              },
            ],
          },
        ],
      },
      '2026-06-01T00:00:00Z',
    );
    expect(rendered.ok).toBe(false);
  });
});
