import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeResearchStore, createResearchStore, openResearchStore } from '../../src/store/db.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'research-store-db-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('createResearchStore / openResearchStore', () => {
  it('creates a new file with the schema applied', () => {
    const dbPath = join(dir, 'fusion.sqlite');
    const store = createResearchStore(dbPath);
    expect(store.path).toBe(dbPath);
    closeResearchStore(store);
  });

  it('opens an existing file created by createResearchStore', () => {
    const dbPath = join(dir, 'fusion.sqlite');
    closeResearchStore(createResearchStore(dbPath));

    const result = openResearchStore(dbPath);
    expect(result.ok).toBe(true);
    if (result.ok) closeResearchStore(result.value);
  });

  it('fails closed (a Result, not a thrown exception) when the file does not exist', () => {
    const result = openResearchStore(join(dir, 'does-not-exist.sqlite'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('not found');
  });

  it('is idempotent: creating the same path twice never errors', () => {
    const dbPath = join(dir, 'fusion.sqlite');
    closeResearchStore(createResearchStore(dbPath));
    expect(() => {
      closeResearchStore(createResearchStore(dbPath));
    }).not.toThrow();
  });
});
