/**
 * Turns a JSON "research update" file into a NEW, auto-numbered migration file under this
 * package's own `src/migrations/` — the no-coding-agent path for growing ANY research domain's
 * dataset (see `docs/adr/0014-sqlite-standard-and-migrations.md`). An update file is a PARTIAL
 * `ResearchDataset` (`ResearchUpdate`, exported from this package's `index.ts`): any subset of
 * `entities`/`relationships`/.../`questions`, each an array of full research-core objects using
 * EXISTING ids from that dataset (see `scripts/printDataset.ts`) or freshly minted ones following
 * that dataset's own id convention.
 *
 * Generic across every domain — this used to live in `@quant-fusion/research-fusion` as
 * `apply:research-update`, defaulting to that one package's dataset id, even though nothing about
 * the merge/validate/migration-generation logic below was ever fusion-specific: every domain's
 * data already lives in this ONE package's migrations (see `src/migrations/0001_init.ts`'s own
 * doc comment on the shared `research_datasets` table), so this package can serve any of them
 * without a domain-specific wrapper. Moved here, and now requires `--dataset-id` (or `--domain`,
 * resolved against the current registry) explicitly rather than defaulting to one domain.
 *
 * Merge semantics are this package's own `mergeResearchUpdate` — see `src/store/merge.ts` for the
 * full rules: a new id in any collection is appended, an id collision is refused except a
 * relationship gaining new `states[]` or a hypothesis gaining new `assessments[]`. The WHOLE
 * merged dataset is validated before anything is written; any issue refuses the whole batch, and
 * no file is written — the same refuse-rather-than-guess posture
 * `packages/stock-market-4/market-data/scripts/fetchAndAppendBars.ts` already uses.
 *
 * Usage:
 *   yarn workspace @quant-fusion/research-store run apply:research-update -- \
 *     --update-file /path/to/update.json (--dataset-id dataset-fusion-2026-09 | --domain fusion)
 *
 * The generated migration file still needs ONE manual step: add its import + array entry to
 * `src/migrations/index.ts` (this script prints the exact lines) — kept manual rather than
 * auto-edited, since a hand-maintained migrations list is simpler and more reviewable than a
 * second file a script silently rewrites.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createResearchStore } from '../src/store/db.js';
import { getResearchDataset, listResearchDatasets } from '../src/store/read.js';
import { renderUpdateSql } from '../src/store/sqlGen.js';
import { nextMigrationNumber, renderMigrationFileSource } from '@quant-fusion/sqlite-migrations';
import type { MergeSummary, ResearchStore, ResearchUpdate } from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MIGRATIONS_DIR = resolve(__dirname, '../src/migrations');

export interface ApplyResearchUpdateOptions {
  /** Defaults to a fresh in-memory store built from this package's own compiled migrations —
   * i.e. the real, current state of every domain. Tests pass their own pre-seeded store. */
  store?: ResearchStore;
  datasetId: string;
  migrationsDir?: string;
  now?: string;
}

export type ApplyResult =
  | {
      ok: true;
      migrationId: string;
      migrationPath: string;
      migrationFileName: string;
      exportName: string;
      newVersion: string;
      summary: MergeSummary;
    }
  | { ok: false; reason: string };

/**
 * The full load -> merge -> validate -> generate pipeline, factored out from `main()` with
 * options so it's testable end-to-end (including the "nothing is written on refusal" guarantee)
 * against a temp store/migrations directory rather than the real ones.
 */
export function applyResearchUpdateToMigration(
  updateFilePath: string,
  options: ApplyResearchUpdateOptions,
): ApplyResult {
  const { datasetId } = options;
  const migrationsDir = options.migrationsDir ?? DEFAULT_MIGRATIONS_DIR;
  const now = options.now ?? new Date().toISOString();
  const store = options.store ?? createResearchStore(':memory:');

  let update: ResearchUpdate;
  try {
    update = JSON.parse(readFileSync(resolve(updateFilePath), 'utf8')) as ResearchUpdate;
  } catch (error) {
    return {
      ok: false,
      reason: `Could not read/parse "${updateFilePath}": ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const currentResult = getResearchDataset(store, datasetId);
  if (!currentResult.ok) {
    return { ok: false, reason: currentResult.reason };
  }

  const rendered = renderUpdateSql(currentResult.value, update, now);
  if (!rendered.ok) {
    return { ok: false, reason: rendered.reason };
  }

  const nextNumber = nextMigrationNumber(migrationsDir);
  const migrationId = `research-store/${nextNumber}_research_update`;
  const exportName = `migration${nextNumber}ResearchUpdate`;
  const migrationFileName = `${nextNumber}_research_update.ts`;
  const migrationPath = join(migrationsDir, migrationFileName);

  const source = renderMigrationFileSource({
    exportName,
    id: migrationId,
    sql: rendered.value.sql,
    docComment: `/** A research update to the "${datasetId}" dataset (version -> "${rendered.value.newVersion}"), generated by\n * \`research-store/scripts/applyResearchUpdate.ts\` from an update file — never hand-edit this\n * file; a correction is always a NEW migration. */`,
  });
  writeFileSync(migrationPath, source, 'utf8');

  return {
    ok: true,
    migrationId,
    migrationPath,
    migrationFileName,
    exportName,
    newVersion: rendered.value.newVersion,
    summary: rendered.value.summary,
  };
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token?.startsWith('--') !== true) continue;
    const name = token.slice(2);
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`--${name} needs a value`);
    args[name] = value;
    i++;
  }
  return args;
}

/** Resolves `--domain` to its dataset id against the current registry — an alternative to
 * `--dataset-id` for a caller (the API) that only knows a domain's public slug. */
function resolveDatasetId(store: ResearchStore, args: Record<string, string>): string {
  if (args['dataset-id'] !== undefined) return args['dataset-id'];
  if (args.domain !== undefined) {
    const match = listResearchDatasets(store).find((d) => d.domain === args.domain);
    if (match === undefined) {
      throw new Error(`no registered research domain "${args.domain}"`);
    }
    return match.datasetId;
  }
  throw new Error(
    'Usage: apply:research-update -- --update-file <path> (--dataset-id <id> | --domain <domain>)',
  );
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const updateFilePath = args['update-file'];
  if (updateFilePath === undefined) {
    console.error(
      'Usage: apply:research-update -- --update-file <path> (--dataset-id <id> | --domain <domain>)',
    );
    process.exitCode = 1;
    return;
  }

  const store = createResearchStore(':memory:');
  let datasetId: string;
  try {
    datasetId = resolveDatasetId(store, args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }

  const result = applyResearchUpdateToMigration(updateFilePath, { store, datasetId });
  if (!result.ok) {
    console.error(`Update refused: ${result.reason}`);
    process.exitCode = 1;
    return;
  }

  console.log('Applied update:');
  for (const [key, count] of Object.entries(result.summary.addedCounts)) {
    console.log(`  ${key}: +${String(count)}`);
  }
  for (const [relationshipId, count] of Object.entries(result.summary.appendedRelationshipStates)) {
    console.log(`  relationship "${relationshipId}": +${String(count)} state(s)`);
  }
  for (const [hypothesisId, count] of Object.entries(
    result.summary.appendedHypothesisAssessments,
  )) {
    console.log(`  hypothesis "${hypothesisId}": +${String(count)} assessment(s)`);
  }
  console.log(`\nWrote ${result.migrationPath} (version -> "${result.newVersion}").`);
  console.log('\nOne manual step left — add these two lines to src/migrations/index.ts:');
  console.log(
    `  import { ${result.exportName} } from './${result.migrationFileName.replace(/\.ts$/, '.js')}';`,
  );
  console.log(`  // ...and add ${result.exportName} to the researchStoreMigrations array.`);
}

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main();
}
