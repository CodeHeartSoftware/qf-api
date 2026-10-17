import { describe, expect, it } from 'vitest';
import { groupByThesisOverlap } from '../../src/portfolio/thesisGroups.js';

describe('groupByThesisOverlap', () => {
  it('groups two tickers sharing enough exposure ids into one group', () => {
    const footprints = new Map([
      ['A', new Set(['reactor-x', 'material-y'])],
      ['B', new Set(['reactor-x', 'material-z'])],
      ['C', new Set(['unrelated-1'])],
    ]);
    const groups = groupByThesisOverlap(footprints, 1);
    const groupWithA = groups.find((g) => g.includes('A'));
    expect(groupWithA?.sort()).toEqual(['A', 'B']);
    expect(groups.find((g) => g.includes('C'))).toEqual(['C']);
  });

  it('does not group two tickers whose overlap is below the threshold', () => {
    const footprints = new Map([
      ['A', new Set(['reactor-x'])],
      ['B', new Set(['reactor-y'])],
    ]);
    const groups = groupByThesisOverlap(footprints, 1);
    expect(groups).toHaveLength(2);
  });

  it('transitively merges A-B and B-C into one group even if A and C share nothing directly', () => {
    const footprints = new Map([
      ['A', new Set(['x'])],
      ['B', new Set(['x', 'y'])],
      ['C', new Set(['y'])],
    ]);
    const groups = groupByThesisOverlap(footprints, 1);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.sort()).toEqual(['A', 'B', 'C']);
  });

  it('respects a higher minSharedIds threshold', () => {
    const footprints = new Map([
      ['A', new Set(['x', 'y'])],
      ['B', new Set(['x', 'z'])], // only 1 shared id
    ]);
    expect(groupByThesisOverlap(footprints, 2)).toHaveLength(2); // not enough overlap at threshold 2
    expect(groupByThesisOverlap(footprints, 1)).toHaveLength(1); // grouped at threshold 1
  });
});
