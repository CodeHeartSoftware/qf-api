import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodeMessage } from '../src/codec.js';

/**
 * The golden fixture corpus (docs/adr/0002-universal-bot-protocol.md) is the shared
 * valid/invalid message set every language SDK's conformance suite is meant to run against.
 * This is that conformance suite for the TypeScript implementation: every file under
 * fixtures/v1/valid must decode successfully, and every file under fixtures/v1/invalid must not.
 */

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'v1');

function listFixtures(kind: 'valid' | 'invalid'): string[] {
  return readdirSync(join(fixturesDir, kind))
    .filter((name) => name.endsWith('.json'))
    .sort();
}

describe('protocol fixture corpus: valid', () => {
  const files = listFixtures('valid');

  it('has at least one fixture per message type', () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  it.each(files)('%s decodes successfully', (file) => {
    const raw = readFileSync(join(fixturesDir, 'valid', file), 'utf8');
    const result = decodeMessage(raw.trim());
    expect(result.ok, result.ok ? '' : `unexpected failure: ${result.reason}`).toBe(true);
  });
});

describe('protocol fixture corpus: invalid', () => {
  const files = listFixtures('invalid');

  it('has at least one fixture per rejection scenario', () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  it.each(files)('%s is rejected', (file) => {
    const raw = readFileSync(join(fixturesDir, 'invalid', file), 'utf8');
    const result = decodeMessage(raw.trim());
    expect(result.ok, 'expected this fixture to fail validation but it decoded successfully').toBe(
      false,
    );
  });
});
