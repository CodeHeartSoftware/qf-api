/**
 * Adds, renames, removes, or (re)categorizes ONE entry in a research domain's registered
 * relationship-type taxonomy (`relationship_types` — see
 * `src/migrations/0038_relationship_types_table.ts`'s own doc comment) — a NEW, auto-numbered
 * migration file per change, same "every mutation is a migration" convention as
 * `manageEntityTypes.ts`. Never touches any relationship already recorded with the old type
 * string, and never touches `@quant-fusion/quant-sdk-js`'s own exposure computation — see
 * `0041_relationship_types_category_column.ts`'s own doc comment for why a category is purely UI
 * categorization.
 *
 * Usage:
 *   yarn workspace @quant-fusion/research-store run manage:relationship-type -- \
 *     --action add --domain fusion --type supplies
 *   yarn workspace @quant-fusion/research-store run manage:relationship-type -- \
 *     --action rename --domain fusion --type supplies --new-type supplies-to
 *   yarn workspace @quant-fusion/research-store run manage:relationship-type -- \
 *     --action delete --domain fusion --type supplies
 *   yarn workspace @quant-fusion/research-store run manage:relationship-type -- \
 *     --action set-category --domain fusion --type supplies --category contract
 *   yarn workspace @quant-fusion/research-store run manage:relationship-type -- \
 *     --action clear-category --domain fusion --type supplies
 *
 * The generated migration file still needs ONE manual step — see `applyResearchUpdate.ts`'s own
 * doc comment for why this stays manual.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nextMigrationNumber, renderMigrationFileSource } from '@quant-fusion/sqlite-migrations';
import { createResearchStore } from '../src/store/db.js';
import { listResearchDatasets } from '../src/store/read.js';
import {
  renderAddRelationshipTypeSql,
  renderDeleteRelationshipTypeSql,
  renderRenameRelationshipTypeSql,
  renderSetRelationshipTypeCategorySql,
} from '../src/store/relationshipTypes.js';
import type { Result } from '../src/result.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MIGRATIONS_DIR = resolve(__dirname, '../src/migrations');

export interface ManageRelationshipTypeOptions {
  action: 'add' | 'rename' | 'delete' | 'set-category' | 'clear-category';
  domain: string;
  type: string;
  /** Required for `action: 'rename'`; ignored otherwise. */
  newType?: string;
  /** Required for `action: 'set-category'`; ignored otherwise (`clear-category` needs no value). */
  category?: string;
  migrationsDir?: string;
  now?: string;
}

export type ManageRelationshipTypeResult =
  | {
      ok: true;
      domain: string;
      type: string;
      migrationId: string;
      migrationPath: string;
      migrationFileName: string;
      exportName: string;
    }
  | { ok: false; reason: string };

function toPascalCase(text: string): string {
  return text
    .split(/[^a-zA-Z0-9]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('');
}

export function manageRelationshipTypeMigration(
  options: ManageRelationshipTypeOptions,
): ManageRelationshipTypeResult {
  const migrationsDir = options.migrationsDir ?? DEFAULT_MIGRATIONS_DIR;
  const now = options.now ?? new Date().toISOString();

  const store = createResearchStore(':memory:');
  const domainRow = listResearchDatasets(store).find((d) => d.domain === options.domain);
  if (domainRow === undefined) {
    return { ok: false, reason: `no registered research domain "${options.domain}"` };
  }

  let rendered: Result<string>;
  if (options.action === 'add') {
    rendered = renderAddRelationshipTypeSql(store, domainRow.datasetId, options.type, now);
  } else if (options.action === 'rename') {
    if (options.newType === undefined) {
      return { ok: false, reason: '--new-type is required for --action rename' };
    }
    rendered = renderRenameRelationshipTypeSql(
      store,
      domainRow.datasetId,
      options.type,
      options.newType,
    );
  } else if (options.action === 'delete') {
    rendered = renderDeleteRelationshipTypeSql(store, domainRow.datasetId, options.type);
  } else if (options.action === 'set-category') {
    if (options.category === undefined) {
      return { ok: false, reason: '--category is required for --action set-category' };
    }
    rendered = renderSetRelationshipTypeCategorySql(
      store,
      domainRow.datasetId,
      options.type,
      options.category,
    );
  } else {
    rendered = renderSetRelationshipTypeCategorySql(store, domainRow.datasetId, options.type, null);
  }
  if (!rendered.ok) {
    return { ok: false, reason: rendered.reason };
  }

  const nextNumber = nextMigrationNumber(migrationsDir);
  const typeSlug = options.type
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');
  const migrationId = `research-store/${nextNumber}_relationship_type_${options.action}_${typeSlug}`;
  const exportName = `migration${nextNumber}RelationshipType${toPascalCase(options.action)}${toPascalCase(options.type)}`;
  const migrationFileName = `${nextNumber}_relationship_type_${options.action}_${typeSlug}.ts`;
  const migrationPath = join(migrationsDir, migrationFileName);

  const docComment =
    options.action === 'add'
      ? `/** Registers "${options.type}" as a relationship type for the "${options.domain}" domain, generated\n * by \`research-store/scripts/manageRelationshipTypes.ts\` — never hand-edit this file; a\n * correction is always a NEW migration. */`
      : options.action === 'rename'
        ? `/** Renames the "${options.domain}" domain's registered relationship type "${options.type}" to\n * "${options.newType ?? ''}", generated by \`research-store/scripts/manageRelationshipTypes.ts\` —\n * never hand-edit this file. Existing relationships already recorded with the old type string are\n * untouched — see \`0038_relationship_types_table.ts\`'s own doc comment for why. */`
        : options.action === 'delete'
          ? `/** Removes the registered relationship type "${options.type}" from the "${options.domain}" domain,\n * generated by \`research-store/scripts/manageRelationshipTypes.ts\` — never hand-edit this file.\n * Existing relationships already recorded with this type string are untouched — see\n * \`0038_relationship_types_table.ts\`'s own doc comment for why. */`
          : options.action === 'set-category'
            ? `/** Sorts the "${options.domain}" domain's registered relationship type "${options.type}" into\n * the "${options.category ?? ''}" Exposure Map category, generated by\n * \`research-store/scripts/manageRelationshipTypes.ts\` — never hand-edit this file. Purely UI\n * categorization for the Quant tab's Exposure Map — see\n * \`0041_relationship_types_category_column.ts\`'s own doc comment. */`
            : `/** Clears the "${options.domain}" domain's registered relationship type "${options.type}" from\n * whatever category it was sorted into, generated by\n * \`research-store/scripts/manageRelationshipTypes.ts\` — never hand-edit this file. */`;

  const source = renderMigrationFileSource({
    exportName,
    id: migrationId,
    sql: rendered.value,
    docComment,
  });
  writeFileSync(migrationPath, source, 'utf8');

  return {
    ok: true,
    domain: options.domain,
    type: options.type,
    migrationId,
    migrationPath,
    migrationFileName,
    exportName,
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

function isAction(value: string): value is ManageRelationshipTypeOptions['action'] {
  return (
    value === 'add' ||
    value === 'rename' ||
    value === 'delete' ||
    value === 'set-category' ||
    value === 'clear-category'
  );
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const usage =
    'Usage: manage:relationship-type -- --action add|rename|delete|set-category|clear-category ' +
    '--domain <domain> --type <type> [--new-type <type>] [--category <name>]';
  if (args.action === undefined || !isAction(args.action)) {
    console.error(usage);
    process.exitCode = 1;
    return;
  }
  if (args.domain === undefined || args.type === undefined) {
    console.error(usage);
    process.exitCode = 1;
    return;
  }
  if (args.action === 'rename' && args['new-type'] === undefined) {
    console.error('--new-type is required for --action rename');
    process.exitCode = 1;
    return;
  }
  if (args.action === 'set-category' && args.category === undefined) {
    console.error('--category is required for --action set-category');
    process.exitCode = 1;
    return;
  }

  const result = manageRelationshipTypeMigration({
    action: args.action,
    domain: args.domain,
    type: args.type,
    ...(args['new-type'] !== undefined ? { newType: args['new-type'] } : {}),
    ...(args.category !== undefined ? { category: args.category } : {}),
  });
  if (!result.ok) {
    console.error(`Refused: ${result.reason}`);
    process.exitCode = 1;
    return;
  }

  const verb = {
    add: 'Added',
    rename: 'Renamed',
    delete: 'Removed',
    'set-category': 'Categorized',
    'clear-category': 'Uncategorized',
  }[args.action];
  console.log(`${verb} relationship type "${result.type}" for domain "${result.domain}".`);
  console.log(`\nWrote ${result.migrationPath}.`);
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
