/**
 * One-off migration: reads the CURRENT `data/dataset.json` (the last artifact of the old
 * JSON-file-based research pipeline) and writes it out as `@quant-fusion/research-store`'s seed
 * migration — the first migration-file-based research content this repo ships (see
 * `docs/adr/0014-sqlite-standard-and-migrations.md`). Zero judgment: a mechanical export of what's
 * already there, exactly like `migrateFixtureToJson.ts` was for the JSON-file move before it.
 * Kept in the repo afterward as documentation of how the seed migration was produced, not deleted
 * once run — re-running it would just regenerate an identical file, since `data/dataset.json` is
 * deleted once this migration lands (see `scripts/applyResearchUpdate.ts`, which replaces
 * `data/dataset.json` edits with new migration files from here on).
 *
 * Usage: yarn workspace @quant-fusion/research-fusion run generate:fusion-seed-migration
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatValidationIssues, validateResearchDataset } from '@quant-fusion/research-core';
import { renderSeedSql } from '@quant-fusion/research-store';
import { renderMigrationFileSource } from '@quant-fusion/sqlite-migrations';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATASET_JSON_PATH = resolve(__dirname, '../data/dataset.json');
const MIGRATION_OUTPUT_PATH = resolve(__dirname, '../../store/src/migrations/0002_fusion_seed.ts');

function main(): void {
  const raw: unknown = JSON.parse(readFileSync(DATASET_JSON_PATH, 'utf8'));
  const validated = validateResearchDataset(raw);
  if (!validated.ok) {
    throw new Error(`${DATASET_JSON_PATH} is invalid: ${formatValidationIssues(validated.issues)}`);
  }

  const rendered = renderSeedSql(validated.value);
  if (!rendered.ok) {
    throw new Error(rendered.reason);
  }

  const source = renderMigrationFileSource({
    exportName: 'migration0002FusionSeed',
    id: 'research-store/0002_fusion_seed',
    sql: rendered.value,
    docComment:
      '/**\n' +
      ' * The fusion research dataset as it stood when this repo moved research content off a\n' +
      ' * checked-in `data/dataset.json` and onto migration files (see\n' +
      ' * `docs/adr/0014-sqlite-standard-and-migrations.md`). Generated, not hand-written — see\n' +
      ' * `research/fusion/scripts/generateFusionSeedMigration.ts`. Every research update from here\n' +
      ' * on lands as its own later migration (`0003_...`, `0004_...`), never an edit to this one.\n' +
      ' */',
  });

  writeFileSync(MIGRATION_OUTPUT_PATH, source, 'utf8');
  console.log(`Wrote ${MIGRATION_OUTPUT_PATH}`);
}

main();
