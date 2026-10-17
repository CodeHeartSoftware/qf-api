/**
 * Creates a brand-new, EMPTY research domain — a single new `research_datasets` row (see
 * `src/migrations/0001_init.ts`'s own doc comment on that table) with none of its 11 collections
 * populated. Never fabricates placeholder entities/relationships/etc. to make a new domain look
 * more filled-in than it is (see README.md) — a domain starts empty and grows the exact same way
 * an existing one does, through `apply:research-update`.
 *
 * This is the whole reason a new research domain no longer needs its own package
 * (`@quant-fusion/research-fusion`, `@quant-fusion/research-quantum`): domain DATA already lived
 * entirely in this package's migrations, and now domain CREATION does too — a package is only
 * worth building once a domain earns bespoke tooling (a forward-match wiring like fusion's
 * `emit:forward-config`, curated fixture-id constants, a research-update "skill" methodology doc,
 * content-specific tests), not on day one.
 *
 * Usage:
 *   yarn workspace @quant-fusion/research-store run create:domain -- \
 *     --name "My New Domain" [--domain my-new-domain]
 *
 * `--domain` (the URL-facing slug) defaults to a slugified `--name`. Refuses if that slug, or the
 * dataset id derived from it, is already registered.
 *
 * The generated migration file still needs ONE manual step — see `applyResearchUpdate.ts`'s own
 * doc comment for why this stays manual.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ResearchDataset } from '@quant-fusion/research-core';
import { nextMigrationNumber, renderMigrationFileSource } from '@quant-fusion/sqlite-migrations';
import { createResearchStore } from '../src/store/db.js';
import { listResearchDatasets } from '../src/store/read.js';
import { renderSeedSql } from '../src/store/sqlGen.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MIGRATIONS_DIR = resolve(__dirname, '../src/migrations');

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export interface CreateResearchDomainOptions {
  name: string;
  domain?: string;
  /** Sidebar display order — higher shown first (see
   * `../src/migrations/0011_research_domain_priority.ts`'s own doc comment). Defaults to `0`,
   * the column's own default, so a newly created domain doesn't automatically outrank an
   * existing, deliberately-prioritized one. */
  priority?: number;
  migrationsDir?: string;
  now?: string;
}

export type CreateResearchDomainResult =
  | {
      ok: true;
      domain: string;
      datasetId: string;
      migrationId: string;
      migrationPath: string;
      migrationFileName: string;
      exportName: string;
    }
  | { ok: false; reason: string };

/** The full validate-no-collision -> build-empty-dataset -> generate pipeline, factored out from
 * `main()` with options so it's testable against a temp migrations directory. */
export function createResearchDomainMigration(
  options: CreateResearchDomainOptions,
): CreateResearchDomainResult {
  const name = options.name.trim();
  if (name === '') {
    return { ok: false, reason: 'domain name must be a non-empty string' };
  }
  const domain = (options.domain ?? slugify(name)).trim();
  if (domain === '') {
    return {
      ok: false,
      reason: `could not derive a usable domain slug from name "${options.name}" — pass --domain explicitly`,
    };
  }
  const migrationsDir = options.migrationsDir ?? DEFAULT_MIGRATIONS_DIR;
  const now = options.now ?? new Date().toISOString();
  const datasetId = `dataset-${domain}`;

  const store = createResearchStore(':memory:');
  const existing = listResearchDatasets(store);
  const domainCollision = existing.find((d) => d.domain === domain);
  if (domainCollision !== undefined) {
    return {
      ok: false,
      reason: `domain "${domain}" already exists (dataset "${domainCollision.datasetId}")`,
    };
  }
  const idCollision = existing.find((d) => d.datasetId === datasetId);
  if (idCollision !== undefined) {
    return {
      ok: false,
      reason: `dataset id "${datasetId}" already exists (domain "${idCollision.domain}")`,
    };
  }

  const dataset: ResearchDataset = {
    id: datasetId,
    domain,
    name,
    version: '1.0.0',
    createdAt: now,
    entities: [],
    relationships: [],
    evidence: [],
    assertions: [],
    hypotheses: [],
    assumptions: [],
    variables: [],
    models: [],
    scenarios: [],
    events: [],
    questions: [],
  };

  const rendered = renderSeedSql(dataset);
  if (!rendered.ok) {
    return { ok: false, reason: rendered.reason };
  }
  // `renderSeedSql` only knows `ResearchDataset`'s own schema, which doesn't include `priority`
  // (see this option's own doc comment on why) — appended explicitly here instead, always, so a
  // freshly created domain's priority is visible in its own migration file rather than relying
  // silently on the column's default.
  const priority = options.priority ?? 0;
  const sql = `${rendered.value}\nUPDATE research_datasets SET priority = ${String(priority)} WHERE dataset_id = ${sqlString(datasetId)};`;

  const nextNumber = nextMigrationNumber(migrationsDir);
  const slugForFile = domain.replace(/-/g, '_');
  const migrationId = `research-store/${nextNumber}_${slugForFile}_seed`;
  const exportName = `migration${nextNumber}${domain
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')}Seed`;
  const migrationFileName = `${nextNumber}_${slugForFile}_seed.ts`;
  const migrationPath = join(migrationsDir, migrationFileName);

  const source = renderMigrationFileSource({
    exportName,
    id: migrationId,
    sql,
    docComment: `/** Seeds the new, empty "${domain}" research domain (dataset "${datasetId}", priority ${String(priority)}), generated by\n * \`research-store/scripts/createResearchDomain.ts\` — never hand-edit this file; growing this\n * domain afterward is always via \`apply:research-update\`. */`,
  });
  writeFileSync(migrationPath, source, 'utf8');

  return { ok: true, domain, datasetId, migrationId, migrationPath, migrationFileName, exportName };
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

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.name === undefined) {
    console.error(
      'Usage: create:domain -- --name "My New Domain" [--domain my-new-domain] [--priority 0]',
    );
    process.exitCode = 1;
    return;
  }
  const priority = args.priority !== undefined ? Number(args.priority) : undefined;
  if (priority !== undefined && !Number.isFinite(priority)) {
    console.error('--priority, when given, must be a number.');
    process.exitCode = 1;
    return;
  }

  const result = createResearchDomainMigration({
    name: args.name,
    ...(args.domain !== undefined ? { domain: args.domain } : {}),
    ...(priority !== undefined ? { priority } : {}),
  });
  if (!result.ok) {
    console.error(`Refused: ${result.reason}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Created domain "${result.domain}" (dataset "${result.datasetId}").`);
  console.log(`\nWrote ${result.migrationPath} (domain -> "${result.domain}").`);
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
