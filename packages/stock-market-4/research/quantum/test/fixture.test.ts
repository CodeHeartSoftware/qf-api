import { validateResearchDataset } from '@quant-fusion/research-core';
import { describe, expect, it } from 'vitest';
import { createQuantumSkeletonDataset } from '../src/index.js';

/**
 * This isn't testing quantum research (there isn't any yet) — it's testing that research-core
 * accepts a totally different domain's vocabulary without any change to research-core itself.
 */
describe('createQuantumSkeletonDataset', () => {
  it('validates cleanly against validateResearchDataset', () => {
    const result = validateResearchDataset(createQuantumSkeletonDataset());
    if (!result.ok) {
      throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n'));
    }
    expect(result.ok).toBe(true);
  });

  it('uses domain-specific type vocabulary research-core never inspects', () => {
    const dataset = createQuantumSkeletonDataset();
    expect(dataset.entities.map((e) => e.type)).toEqual(
      expect.arrayContaining(['quantum-architecture', 'error-correction-code']),
    );
  });
});
