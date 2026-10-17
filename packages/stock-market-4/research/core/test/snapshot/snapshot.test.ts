import { describe, expect, it } from 'vitest';
import { createResearchSnapshot, parseResearchSnapshot } from '../../src/snapshot/snapshot.js';
import { computeResearchStateAt } from '../../src/state/provider.js';
import type { ResearchDataset } from '../../src/dataset/dataset.js';

function emptyDataset(overrides: Record<string, unknown> = {}): ResearchDataset {
  return {
    id: 'dataset-fixture',
    name: 'Snapshot fixture',
    version: '2.3.1',
    domain: 'test',
    createdAt: '2026-01-01T00:00:00Z',
    entities: [],
    relationships: [],
    evidence: [],
    assertions: [],
    hypotheses: [],
    assumptions: [],
    variables: [],
    models: [],
    scenarios: [],
    events: [],
    questions: [],
    ...overrides,
  };
}

describe('createResearchSnapshot', () => {
  it('carries the dataset id and version, and the requested timestamp', () => {
    const dataset = emptyDataset();
    const snapshot = createResearchSnapshot(dataset, '2026-06-01T00:00:00Z');
    expect(snapshot.datasetId).toBe('dataset-fixture');
    expect(snapshot.datasetVersion).toBe('2.3.1');
    expect(snapshot.timestamp).toBe('2026-06-01T00:00:00Z');
  });

  it('embeds exactly the state computeResearchStateAt would produce', () => {
    const dataset = emptyDataset({
      entities: [
        { id: 'entity-arc', type: 'reactor', name: 'ARC', recordedAt: '2026-01-01T00:00:00Z' },
      ],
    });
    const snapshot = createResearchSnapshot(dataset, '2026-06-01T00:00:00Z');
    expect(snapshot.state).toEqual(computeResearchStateAt(dataset, '2026-06-01T00:00:00Z'));
  });

  it('produces a snapshot that validates cleanly against ResearchSnapshotSchema', () => {
    const dataset = emptyDataset({
      entities: [
        { id: 'entity-arc', type: 'reactor', name: 'ARC', recordedAt: '2026-01-01T00:00:00Z' },
      ],
    });
    const snapshot = createResearchSnapshot(dataset, '2026-06-01T00:00:00Z');
    expect(parseResearchSnapshot(snapshot)).toEqual({ ok: true, value: snapshot });
  });
});

describe('parseResearchSnapshot', () => {
  it('requires datasetId, datasetVersion, timestamp, and state', () => {
    expect(parseResearchSnapshot({}).ok).toBe(false);
  });

  it('rejects unknown extra fields', () => {
    const dataset = emptyDataset();
    const snapshot = createResearchSnapshot(dataset, '2026-06-01T00:00:00Z');
    expect(parseResearchSnapshot({ ...snapshot, unexpected: 'field' }).ok).toBe(false);
  });
});
