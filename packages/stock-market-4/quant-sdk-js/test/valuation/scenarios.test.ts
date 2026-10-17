import { describe, expect, it } from 'vitest';
import {
  combineScenarios,
  constantScenario,
  mapScenario,
  sumScenarios,
} from '../../src/valuation/scenarios.js';

describe('scenario helpers', () => {
  it('mapScenario applies fn to each leg independently', () => {
    expect(mapScenario({ bear: 1, base: 2, bull: 3 }, (x) => x * 10)).toEqual({
      bear: 10,
      base: 20,
      bull: 30,
    });
  });

  it('combineScenarios never cross-multiplies bear with bull', () => {
    const a = { bear: 1, base: 2, bull: 3 };
    const b = { bear: 10, base: 20, bull: 30 };
    expect(combineScenarios(a, b, (x, y) => x * y)).toEqual({ bear: 10, base: 40, bull: 90 });
  });

  it('sumScenarios adds every leg across multiple ScenarioValues', () => {
    const result = sumScenarios([
      { bear: 1, base: 2, bull: 3 },
      { bear: 10, base: 10, bull: 10 },
      { bear: 0, base: 5, bull: 100 },
    ]);
    expect(result).toEqual({ bear: 11, base: 17, bull: 113 });
  });

  it('sumScenarios of an empty list is all zeros', () => {
    expect(sumScenarios([])).toEqual({ bear: 0, base: 0, bull: 0 });
  });

  it('constantScenario sets every leg equal', () => {
    expect(constantScenario(5)).toEqual({ bear: 5, base: 5, bull: 5 });
  });
});
