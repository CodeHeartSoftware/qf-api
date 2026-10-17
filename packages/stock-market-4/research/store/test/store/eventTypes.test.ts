import { describe, expect, it } from 'vitest';
import { createResearchStore } from '../../src/store/db.js';
import {
  listEventTypes,
  renderAddEventTypeSql,
  renderDeleteEventTypeSql,
  renderRenameEventTypeSql,
} from '../../src/store/eventTypes.js';

const FUSION_DATASET_ID = 'dataset-fusion-2026-09';

describe('listEventTypes', () => {
  it('lists the real, migration-seeded fusion event types', () => {
    const store = createResearchStore(':memory:');
    const types = listEventTypes(store, FUSION_DATASET_ID).map((t) => t.type);
    expect(types.length).toBeGreaterThan(0);
    expect(new Set(types).size).toBe(types.length);
  });

  it('is empty for a domain with no events (e.g. quantum)', () => {
    const store = createResearchStore(':memory:');
    expect(listEventTypes(store, 'dataset-quantum-skeleton')).toEqual([]);
  });
});

describe('renderAddEventTypeSql', () => {
  it('renders an INSERT for a new type', () => {
    const store = createResearchStore(':memory:');
    const rendered = renderAddEventTypeSql(
      store,
      FUSION_DATASET_ID,
      'BRAND_NEW_TYPE',
      '2026-09-20T00:00:00Z',
    );
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(rendered.value).toContain('INSERT INTO event_types');
    expect(rendered.value).toContain('BRAND_NEW_TYPE');
  });

  it('refuses a type already registered for this domain (case-insensitive)', () => {
    const store = createResearchStore(':memory:');
    const existingType = listEventTypes(store, FUSION_DATASET_ID)[0]?.type;
    expect(existingType).toBeDefined();
    const rendered = renderAddEventTypeSql(
      store,
      FUSION_DATASET_ID,
      (existingType ?? '').toLowerCase(),
      '2026-09-20T00:00:00Z',
    );
    expect(rendered.ok).toBe(false);
  });

  it('refuses a blank type', () => {
    const store = createResearchStore(':memory:');
    expect(renderAddEventTypeSql(store, FUSION_DATASET_ID, '  ', '2026-09-20T00:00:00Z').ok).toBe(
      false,
    );
  });
});

describe('renderRenameEventTypeSql', () => {
  it('renders an UPDATE for an existing type', () => {
    const store = createResearchStore(':memory:');
    const existingType = listEventTypes(store, FUSION_DATASET_ID)[0]?.type;
    expect(existingType).toBeDefined();
    const rendered = renderRenameEventTypeSql(
      store,
      FUSION_DATASET_ID,
      existingType ?? '',
      'RENAMED_TYPE',
    );
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(rendered.value).toContain('UPDATE event_types');
    expect(rendered.value).toContain('RENAMED_TYPE');
  });

  it('refuses renaming a type that is not registered', () => {
    const store = createResearchStore(':memory:');
    const rendered = renderRenameEventTypeSql(store, FUSION_DATASET_ID, 'NOPE', 'ALSO_NOPE');
    expect(rendered.ok).toBe(false);
  });

  it('refuses renaming onto an already-registered type', () => {
    const store = createResearchStore(':memory:');
    const [first, second] = listEventTypes(store, FUSION_DATASET_ID);
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    const rendered = renderRenameEventTypeSql(
      store,
      FUSION_DATASET_ID,
      first?.type ?? '',
      second?.type ?? '',
    );
    expect(rendered.ok).toBe(false);
  });
});

describe('renderDeleteEventTypeSql', () => {
  it('renders a DELETE for an existing type', () => {
    const store = createResearchStore(':memory:');
    const existingType = listEventTypes(store, FUSION_DATASET_ID)[0]?.type;
    expect(existingType).toBeDefined();
    const rendered = renderDeleteEventTypeSql(store, FUSION_DATASET_ID, existingType ?? '');
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(rendered.value).toContain('DELETE FROM event_types');
  });

  it('refuses a type that is not registered', () => {
    const store = createResearchStore(':memory:');
    const rendered = renderDeleteEventTypeSql(store, FUSION_DATASET_ID, 'NOPE');
    expect(rendered.ok).toBe(false);
  });
});
