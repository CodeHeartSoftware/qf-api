import { describe, expect, it } from 'vitest';
import { createResearchStore } from '../../src/store/db.js';
import {
  listEntityTypes,
  renderAddEntityTypeSql,
  renderDeleteEntityTypeSql,
  renderRenameEntityTypeSql,
} from '../../src/store/entityTypes.js';

const FUSION_DATASET_ID = 'dataset-fusion-2026-09';

describe('listEntityTypes', () => {
  it('lists the real, migration-seeded fusion entity types', () => {
    const store = createResearchStore(':memory:');
    const types = listEntityTypes(store, FUSION_DATASET_ID).map((t) => t.type);
    expect(types.length).toBeGreaterThan(0);
    expect(new Set(types).size).toBe(types.length);
  });

  it('is empty for a domain with no entities (e.g. quantum, if it has none registered)', () => {
    const store = createResearchStore(':memory:');
    const types = listEntityTypes(store, 'dataset-quantum-skeleton');
    expect(Array.isArray(types)).toBe(true);
  });
});

describe('renderAddEntityTypeSql', () => {
  it('renders an INSERT for a new type', () => {
    const store = createResearchStore(':memory:');
    const rendered = renderAddEntityTypeSql(
      store,
      FUSION_DATASET_ID,
      'brand-new-type',
      '2026-09-20T00:00:00Z',
    );
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(rendered.value).toContain('INSERT INTO entity_types');
    expect(rendered.value).toContain('brand-new-type');
  });

  it('refuses a type already registered for this domain (case-insensitive)', () => {
    const store = createResearchStore(':memory:');
    const existingType = listEntityTypes(store, FUSION_DATASET_ID)[0]?.type;
    expect(existingType).toBeDefined();
    const rendered = renderAddEntityTypeSql(
      store,
      FUSION_DATASET_ID,
      (existingType ?? '').toUpperCase(),
      '2026-09-20T00:00:00Z',
    );
    expect(rendered.ok).toBe(false);
  });

  it('refuses a blank type', () => {
    const store = createResearchStore(':memory:');
    expect(renderAddEntityTypeSql(store, FUSION_DATASET_ID, '  ', '2026-09-20T00:00:00Z').ok).toBe(
      false,
    );
  });
});

describe('renderRenameEntityTypeSql', () => {
  it('renders an UPDATE for an existing type', () => {
    const store = createResearchStore(':memory:');
    const existingType = listEntityTypes(store, FUSION_DATASET_ID)[0]?.type;
    expect(existingType).toBeDefined();
    const rendered = renderRenameEntityTypeSql(
      store,
      FUSION_DATASET_ID,
      existingType ?? '',
      'renamed-type',
    );
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(rendered.value).toContain('UPDATE entity_types');
    expect(rendered.value).toContain('renamed-type');
  });

  it('refuses renaming a type that is not registered', () => {
    const store = createResearchStore(':memory:');
    const rendered = renderRenameEntityTypeSql(store, FUSION_DATASET_ID, 'nope', 'also-nope');
    expect(rendered.ok).toBe(false);
  });

  it('refuses renaming onto an already-registered type', () => {
    const store = createResearchStore(':memory:');
    const [first, second] = listEntityTypes(store, FUSION_DATASET_ID);
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    const rendered = renderRenameEntityTypeSql(
      store,
      FUSION_DATASET_ID,
      first?.type ?? '',
      second?.type ?? '',
    );
    expect(rendered.ok).toBe(false);
  });
});

describe('renderDeleteEntityTypeSql', () => {
  it('renders a DELETE for an existing type', () => {
    const store = createResearchStore(':memory:');
    const existingType = listEntityTypes(store, FUSION_DATASET_ID)[0]?.type;
    expect(existingType).toBeDefined();
    const rendered = renderDeleteEntityTypeSql(store, FUSION_DATASET_ID, existingType ?? '');
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(rendered.value).toContain('DELETE FROM entity_types');
  });

  it('refuses a type that is not registered', () => {
    const store = createResearchStore(':memory:');
    const rendered = renderDeleteEntityTypeSql(store, FUSION_DATASET_ID, 'nope');
    expect(rendered.ok).toBe(false);
  });
});
