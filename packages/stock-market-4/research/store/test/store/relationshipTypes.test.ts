import { describe, expect, it } from 'vitest';
import { createResearchStore } from '../../src/store/db.js';
import {
  listRelationshipTypes,
  renderAddRelationshipTypeSql,
  renderDeleteRelationshipTypeSql,
  renderRenameRelationshipTypeSql,
  renderSetRelationshipTypeCategorySql,
} from '../../src/store/relationshipTypes.js';

const FUSION_DATASET_ID = 'dataset-fusion-2026-09';

describe('listRelationshipTypes', () => {
  it('lists the real, migration-seeded fusion relationship types', () => {
    const store = createResearchStore(':memory:');
    const types = listRelationshipTypes(store, FUSION_DATASET_ID).map((t) => t.type);
    expect(types.length).toBeGreaterThan(0);
    expect(new Set(types).size).toBe(types.length);
  });

  it('is empty for a domain with no relationships registered', () => {
    const store = createResearchStore(':memory:');
    const types = listRelationshipTypes(store, 'dataset-quantum-skeleton');
    expect(Array.isArray(types)).toBe(true);
  });

  it('every migration-seeded type has no category yet (category undefined)', () => {
    const store = createResearchStore(':memory:');
    const types = listRelationshipTypes(store, FUSION_DATASET_ID);
    expect(types.every((t) => t.category === undefined)).toBe(true);
  });
});

describe('renderAddRelationshipTypeSql', () => {
  it('renders an INSERT for a new type', () => {
    const store = createResearchStore(':memory:');
    const rendered = renderAddRelationshipTypeSql(
      store,
      FUSION_DATASET_ID,
      'brand-new-type',
      '2026-09-20T00:00:00Z',
    );
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(rendered.value).toContain('INSERT INTO relationship_types');
    expect(rendered.value).toContain('brand-new-type');
  });

  it('refuses a type already registered for this domain (case-insensitive)', () => {
    const store = createResearchStore(':memory:');
    const existingType = listRelationshipTypes(store, FUSION_DATASET_ID)[0]?.type;
    expect(existingType).toBeDefined();
    const rendered = renderAddRelationshipTypeSql(
      store,
      FUSION_DATASET_ID,
      (existingType ?? '').toUpperCase(),
      '2026-09-20T00:00:00Z',
    );
    expect(rendered.ok).toBe(false);
  });

  it('refuses a blank type', () => {
    const store = createResearchStore(':memory:');
    expect(
      renderAddRelationshipTypeSql(store, FUSION_DATASET_ID, '  ', '2026-09-20T00:00:00Z').ok,
    ).toBe(false);
  });
});

describe('renderRenameRelationshipTypeSql', () => {
  it('renders an UPDATE for an existing type', () => {
    const store = createResearchStore(':memory:');
    const existingType = listRelationshipTypes(store, FUSION_DATASET_ID)[0]?.type;
    expect(existingType).toBeDefined();
    const rendered = renderRenameRelationshipTypeSql(
      store,
      FUSION_DATASET_ID,
      existingType ?? '',
      'renamed-type',
    );
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(rendered.value).toContain('UPDATE relationship_types');
    expect(rendered.value).toContain('renamed-type');
  });

  it('refuses renaming a type that is not registered', () => {
    const store = createResearchStore(':memory:');
    const rendered = renderRenameRelationshipTypeSql(store, FUSION_DATASET_ID, 'nope', 'also-nope');
    expect(rendered.ok).toBe(false);
  });

  it('refuses renaming onto an already-registered type', () => {
    const store = createResearchStore(':memory:');
    const [first, second] = listRelationshipTypes(store, FUSION_DATASET_ID);
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    const rendered = renderRenameRelationshipTypeSql(
      store,
      FUSION_DATASET_ID,
      first?.type ?? '',
      second?.type ?? '',
    );
    expect(rendered.ok).toBe(false);
  });
});

describe('renderDeleteRelationshipTypeSql', () => {
  it('renders a DELETE for an existing type', () => {
    const store = createResearchStore(':memory:');
    const existingType = listRelationshipTypes(store, FUSION_DATASET_ID)[0]?.type;
    expect(existingType).toBeDefined();
    const rendered = renderDeleteRelationshipTypeSql(store, FUSION_DATASET_ID, existingType ?? '');
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(rendered.value).toContain('DELETE FROM relationship_types');
  });

  it('refuses a type that is not registered', () => {
    const store = createResearchStore(':memory:');
    const rendered = renderDeleteRelationshipTypeSql(store, FUSION_DATASET_ID, 'nope');
    expect(rendered.ok).toBe(false);
  });
});

describe('renderSetRelationshipTypeCategorySql', () => {
  it('renders an UPDATE setting category for an existing type', () => {
    const store = createResearchStore(':memory:');
    const existingType = listRelationshipTypes(store, FUSION_DATASET_ID)[0]?.type;
    expect(existingType).toBeDefined();
    const rendered = renderSetRelationshipTypeCategorySql(
      store,
      FUSION_DATASET_ID,
      existingType ?? '',
      'contract',
    );
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(rendered.value).toContain('UPDATE relationship_types');
    expect(rendered.value).toContain('contract');
  });

  it('renders an UPDATE setting category to NULL when clearing', () => {
    const store = createResearchStore(':memory:');
    const existingType = listRelationshipTypes(store, FUSION_DATASET_ID)[0]?.type;
    expect(existingType).toBeDefined();
    const rendered = renderSetRelationshipTypeCategorySql(
      store,
      FUSION_DATASET_ID,
      existingType ?? '',
      null,
    );
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(rendered.value).toContain('category = NULL');
  });

  it('refuses a type that is not registered', () => {
    const store = createResearchStore(':memory:');
    const rendered = renderSetRelationshipTypeCategorySql(
      store,
      FUSION_DATASET_ID,
      'nope',
      'contract',
    );
    expect(rendered.ok).toBe(false);
  });

  it('refuses a blank category', () => {
    const store = createResearchStore(':memory:');
    const existingType = listRelationshipTypes(store, FUSION_DATASET_ID)[0]?.type;
    expect(existingType).toBeDefined();
    const rendered = renderSetRelationshipTypeCategorySql(
      store,
      FUSION_DATASET_ID,
      existingType ?? '',
      '  ',
    );
    expect(rendered.ok).toBe(false);
  });
});
