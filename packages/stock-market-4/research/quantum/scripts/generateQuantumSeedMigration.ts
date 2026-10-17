/**
 * One-off migration: dumps the CURRENT `createQuantumSkeletonDataset()` output (until now built
 * inline in TypeScript) as `@quant-fusion/research-store`'s seed migration for this domain (see
 * `docs/adr/0014-sqlite-standard-and-migrations.md`). Mirrors
 * `research/fusion/scripts/generateFusionSeedMigration.ts`. Kept in the repo afterward as
 * documentation of how the seed migration was produced, not deleted once run.
 *
 * Usage: yarn workspace @quant-fusion/research-quantum run generate:quantum-seed-migration
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { renderSeedSql } from '@quant-fusion/research-store';
import { renderMigrationFileSource } from '@quant-fusion/sqlite-migrations';
import { createQuantumSkeletonDataset } from '../src/fixture.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_OUTPUT_PATH = resolve(__dirname, '../../store/src/migrations/0003_quantum_seed.ts');

function main(): void {
  const rendered = renderSeedSql(createQuantumSkeletonDataset());
  if (!rendered.ok) {
    throw new Error(rendered.reason);
  }

  const source = renderMigrationFileSource({
    exportName: 'migration0003QuantumSeed',
    id: 'research-store/0003_quantum_seed',
    sql: rendered.value,
    docComment:
      '/**\n' +
      ' * The quantum research skeleton dataset, generated from what used to be\n' +
      " * `createQuantumSkeletonDataset()`'s inline TypeScript construction — see\n" +
      ' * `research/quantum/scripts/generateQuantumSeedMigration.ts`. Every research update from\n' +
      ' * here on lands as its own later migration, never an edit to this one.\n' +
      ' */',
  });

  writeFileSync(MIGRATION_OUTPUT_PATH, source, 'utf8');
  console.log(`Wrote ${MIGRATION_OUTPUT_PATH}`);
}

main();
