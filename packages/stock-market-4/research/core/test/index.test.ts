import { describe, expect, it } from 'vitest';
import { RESEARCH_CORE_PACKAGE_NAME } from '../src/index.js';

describe('package scaffold', () => {
  it('exposes its own package name from the public barrel', () => {
    expect(RESEARCH_CORE_PACKAGE_NAME).toBe('@quant-fusion/research-core');
  });
});
