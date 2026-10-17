import { describe, expect, it } from 'vitest';
import { createResearchStore } from '../../src/store/db.js';
import { listResearchDatasets } from '../../src/store/read.js';

describe('listResearchDatasets', () => {
  it('lists every registered domain from the real, current migrations, including fusion and quantum', () => {
    const store = createResearchStore(':memory:');
    const domains = listResearchDatasets(store).map((d) => d.domain);
    expect(domains).toContain('fusion');
    expect(domains).toContain('quantum');
  });

  it('returns each row with its own dataset id, name, and version', () => {
    const store = createResearchStore(':memory:');
    const fusion = listResearchDatasets(store).find((d) => d.domain === 'fusion');
    expect(fusion).toBeDefined();
    expect(fusion?.datasetId).toBe('dataset-fusion-2026-09');
    expect(fusion?.name.length).toBeGreaterThan(0);
    expect(fusion?.version.length).toBeGreaterThan(0);
  });

  it('sorts by priority (highest first) — fusion before quantum', () => {
    const store = createResearchStore(':memory:');
    const domains = listResearchDatasets(store).map((d) => d.domain);
    expect(domains.indexOf('fusion')).toBeLessThan(domains.indexOf('quantum'));
  });

  it('returns each row with its own real priority', () => {
    const store = createResearchStore(':memory:');
    const domains = listResearchDatasets(store);
    expect(domains.find((d) => d.domain === 'fusion')?.priority).toBe(100);
    expect(domains.find((d) => d.domain === 'quantum')?.priority).toBe(10);
  });
});
