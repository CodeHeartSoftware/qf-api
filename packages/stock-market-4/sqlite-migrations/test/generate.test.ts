import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  escapeForTemplateLiteral,
  nextMigrationNumber,
  renderMigrationFileSource,
} from '../src/generate.js';

/** Evaluates `escaped` as a REAL JS template literal body (via the `Function` constructor, i.e.
 * the actual JS engine's own parsing — not a hand-rolled simulation) — this is the exact
 * transformation a generated migration file undergoes when Node loads it. */
function evaluateAsTemplateLiteral(escaped: string): string {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call -- deliberately exercising real JS template-literal parsing, the actual risk this module protects against.
  return new Function(`return \`${escaped}\`;`)() as string;
}

describe('escapeForTemplateLiteral', () => {
  it('round-trips plain text unchanged', () => {
    const original = "INSERT INTO widgets (id, data) VALUES ('a', 'hello world');";
    expect(evaluateAsTemplateLiteral(escapeForTemplateLiteral(original))).toBe(original);
  });

  it('round-trips a literal backslash-n (e.g. from JSON.stringify of a multi-line string), not an actual newline', () => {
    // Simulates JSON.stringify({ description: "line1\nline2" }) — the SQL text contains the two
    // literal characters `\` and `n`, which must survive re-parsing as those same two characters,
    // not be converted into an actual newline byte.
    const original = String.raw`{"description":"line1\nline2"}`;
    const roundTripped = evaluateAsTemplateLiteral(escapeForTemplateLiteral(original));
    expect(roundTripped).toBe(original);
    expect(roundTripped).not.toContain('\n');
  });

  it('round-trips a literal backtick', () => {
    const original = 'SELECT 1; -- contains a ` character';
    expect(evaluateAsTemplateLiteral(escapeForTemplateLiteral(original))).toBe(original);
  });

  it('round-trips a literal ${ sequence without triggering interpolation', () => {
    const original = 'some text with a ${fake} interpolation-looking sequence';
    expect(evaluateAsTemplateLiteral(escapeForTemplateLiteral(original))).toBe(original);
  });
});

describe('nextMigrationNumber', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'next-migration-number-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns 0001 for an empty directory', () => {
    expect(nextMigrationNumber(dir)).toBe('0001');
  });

  it('returns one past the highest existing NNNN_*.ts file', () => {
    writeFileSync(join(dir, '0001_init.ts'), '', 'utf8');
    writeFileSync(join(dir, '0003_something.ts'), '', 'utf8');
    expect(nextMigrationNumber(dir)).toBe('0004');
  });

  it('ignores index.ts and other non-numbered files', () => {
    writeFileSync(join(dir, '0001_init.ts'), '', 'utf8');
    writeFileSync(join(dir, 'index.ts'), '', 'utf8');
    writeFileSync(join(dir, 'README.md'), '', 'utf8');
    expect(nextMigrationNumber(dir)).toBe('0002');
  });
});

describe('renderMigrationFileSource', () => {
  it('produces source containing the exact migration id and export name', () => {
    const source = renderMigrationFileSource({
      exportName: 'migration0002Example',
      id: 'research-store/0002_example',
      sql: "INSERT INTO widgets (id) VALUES ('a');",
      docComment: '/** An example migration. */',
    });
    expect(source).toContain('export const migration0002Example: Migration = {');
    expect(source).toContain('id: "research-store/0002_example"');
    expect(source).toContain('/** An example migration. */');
  });

  it('produces source whose evaluated sql exactly matches the input, even with tricky characters', () => {
    const trickySql = String.raw`INSERT INTO t (data) VALUES ('{"a":"line1\nline2","b":"back\\slash","c":"tick\`"}');`;
    const source = renderMigrationFileSource({
      exportName: 'migrationTricky',
      id: 'research-store/9999_tricky',
      sql: trickySql,
      docComment: '/** Tricky content. */',
    });

    // Extract the template literal body between the first pair of backticks after `sql: ` and
    // evaluate it exactly as the JS engine would when this file is actually imported.
    const match = /sql: `\n([\s\S]*)\n`,/.exec(source);
    expect(match).not.toBeNull();
    const evaluated = evaluateAsTemplateLiteral(match?.[1] ?? '');
    expect(evaluated).toBe(trickySql);
  });
});
