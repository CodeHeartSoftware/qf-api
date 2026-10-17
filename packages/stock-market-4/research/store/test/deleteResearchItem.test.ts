import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ResearchDataset } from '@quant-fusion/research-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createResearchStore } from '../src/store/db.js';
import type { ResearchStore } from '../src/store/db.js';
import { renderSeedSql } from '../src/store/sqlGen.js';
import { deleteResearchItemMigration } from '../scripts/deleteResearchItem.js';

/** Mirrors `applyResearchUpdate.test.ts`'s own `minimalDataset` — an unreferenced entity
 * (`entity-c`) alongside a referenced pair (`entity-a`/`entity-b`, tied together by `rel-a-b`)
 * so both the "safe to delete" and "still referenced, refuse" paths have something real to test
 * against. */
function minimalDataset(): ResearchDataset {
  return {
    id: 'dataset-test',
    name: 'Test dataset',
    version: '1.0',
    domain: 'test',
    createdAt: '2026-01-01T00:00:00Z',
    entities: [
      { id: 'entity-a', type: 'company', name: 'A Corp', recordedAt: '2026-01-01T00:00:00Z' },
      { id: 'entity-b', type: 'company', name: 'B Corp', recordedAt: '2026-01-01T00:00:00Z' },
      { id: 'entity-c', type: 'company', name: 'C Corp', recordedAt: '2026-01-01T00:00:00Z' },
    ],
    relationships: [
      {
        id: 'rel-a-b',
        type: 'supplies',
        fromEntityId: 'entity-a',
        toEntityId: 'entity-b',
        states: [
          {
            status: 'qualification track',
            recordedAt: '2026-01-01T00:00:00Z',
            effectiveFrom: '2026-01-01T00:00:00Z',
            evidenceIds: [],
          },
        ],
      },
    ],
    evidence: [],
    assertions: [],
    hypotheses: [
      {
        id: 'hypothesis-h1',
        name: 'H1',
        statement: 'Some statement.',
        status: 'active',
        createdAt: '2026-01-01T00:00:00Z',
        assessments: [],
      },
    ],
    assumptions: [],
    variables: [],
    models: [],
    scenarios: [],
    events: [],
    questions: [],
  };
}

let tempDir: string;
let migrationsDir: string;
let store: ResearchStore;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'delete-research-item-test-'));
  migrationsDir = join(tempDir, 'migrations');
  mkdirSync(migrationsDir, { recursive: true });
  store = createResearchStore(':memory:'); // also seeds the real fusion/quantum data — harmless
  const seedSql = renderSeedSql(minimalDataset());
  if (!seedSql.ok) throw new Error(seedSql.reason);
  store.db.exec(seedSql.value);
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('deleteResearchItemMigration', () => {
  it('deletes an unreferenced entity and writes a new, auto-numbered migration file', () => {
    const result = deleteResearchItemMigration({
      store,
      domain: 'test',
      collection: 'entities',
      id: 'entity-c',
      migrationsDir,
      now: '2026-03-01T00:00:00Z',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const written = readFileSync(result.migrationPath, 'utf8');
    expect(written).toContain('DELETE FROM entities');
    expect(written).toContain('entity-c');
    expect(written).toContain('UPDATE research_datasets SET version');
  });

  it('refuses to delete an entity still referenced by a relationship', () => {
    const result = deleteResearchItemMigration({
      store,
      domain: 'test',
      collection: 'entities',
      id: 'entity-a',
      migrationsDir,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/still referenced/);
  });

  it('deletes a relationship with no cross-collection referential-integrity concern', () => {
    const result = deleteResearchItemMigration({
      store,
      domain: 'test',
      collection: 'relationships',
      id: 'rel-a-b',
      migrationsDir,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const written = readFileSync(result.migrationPath, 'utf8');
    expect(written).toContain('DELETE FROM relationships');
    expect(written).toContain('rel-a-b');
  });

  it('deletes a hypothesis with no cross-collection referential-integrity concern', () => {
    const result = deleteResearchItemMigration({
      store,
      domain: 'test',
      collection: 'hypotheses',
      id: 'hypothesis-h1',
      migrationsDir,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const written = readFileSync(result.migrationPath, 'utf8');
    expect(written).toContain('DELETE FROM hypotheses');
    expect(written).toContain('hypothesis-h1');
  });

  it('refuses an unknown domain', () => {
    const result = deleteResearchItemMigration({
      store,
      domain: 'does-not-exist',
      collection: 'entities',
      id: 'entity-c',
      migrationsDir,
    });
    expect(result.ok).toBe(false);
  });

  it('refuses an id that does not exist in the collection', () => {
    const result = deleteResearchItemMigration({
      store,
      domain: 'test',
      collection: 'entities',
      id: 'entity-does-not-exist',
      migrationsDir,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/nothing to delete/);
  });
});
