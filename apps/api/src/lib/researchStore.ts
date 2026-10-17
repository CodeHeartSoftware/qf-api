import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ResearchDataset } from '@quant-fusion/research-core';
import { registerMigration } from './migrationRegistration.js';
import { runCommand } from './subprocess.js';

// Anchored to THIS file's own location, not a `rootDir` parameter — `research-store` is this
// API's own workspace dependency, always at a fixed path relative to wherever this package itself
// is installed/built, unlike `rootDir`'s other uses (`.quant-fusion/`, `bots/`) which genuinely can
// point at a different live-data directory. Same reasoning as the retired `fusionDataset.ts`'s own
// anchor (see git history) — research domains now live entirely in `@quant-fusion/research-store`,
// not in a domain-specific package, so this is the ONE place the API needs to know about.
const RESEARCH_STORE_PACKAGE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/stock-market-4/research/store',
);

const RESEARCH_STORE_MIGRATIONS_INDEX = path.join(
  RESEARCH_STORE_PACKAGE_DIR,
  'src',
  'migrations',
  'index.ts',
);

async function runResearchStoreScript(args: string[]) {
  return runCommand('yarn', ['run', '--silent', ...args], { cwd: RESEARCH_STORE_PACKAGE_DIR });
}

export interface ResearchDomainSummary {
  domain: string;
  id: string;
  name: string;
  version: string;
  /** Sidebar display order — higher shown first. `listResearchDomains` already returns domains
   * in this order (see `@quant-fusion/research-store`'s own `listResearchDatasets`); this field is
   * for display/transparency, not something a caller needs to sort by again. */
  priority: number;
  entityCount: number;
  relationshipCount: number;
  hypothesisCount: number;
  eventCount: number;
}

/** Every registered research domain — a fresh process each time (see this file's own comment on
 * why a long-lived server can't just import this once): `@quant-fusion/research-store`'s own
 * `print:domains` script queries its `research_datasets` table, so "which domains exist" is
 * always current, including one `createResearchDomain` below just added. */
export async function listResearchDomains(): Promise<ResearchDomainSummary[]> {
  const result = await runResearchStoreScript(['print:domains']);
  if (!result.ok) {
    throw new Error(`print:domains failed:\n${result.output}`);
  }
  const parsed = JSON.parse(result.stdout) as { domains: ResearchDomainSummary[] };
  return parsed.domains;
}

export type LoadResearchDatasetResult =
  { ok: true; dataset: ResearchDataset } | { ok: false; error: string };

/** One domain's full current dataset, resolved by its public slug — see `listResearchDomains`'s
 * own comment on why this is a fresh subprocess, not an in-process import. A domain that doesn't
 * exist is a normal `{ok: false}` outcome here, not a thrown error — callers map it to 404. */
export async function loadResearchDataset(domain: string): Promise<LoadResearchDatasetResult> {
  const result = await runResearchStoreScript(['print:dataset', '--', '--domain', domain]);
  if (!result.ok) {
    throw new Error(`print:dataset failed:\n${result.output}`);
  }
  return JSON.parse(result.stdout) as LoadResearchDatasetResult;
}

/** Parses the exact `import { <exportName> } from './<file>.js';` line every migration-generating
 * script here prints as its "one manual step left" — the one robust way to recover the export
 * name a script derived from domain-specific naming (a fixed formula only for the update
 * pipeline, but genuinely domain-dependent for a freshly created one), rather than re-deriving it
 * independently here and risking drift. */
function parseGeneratedImport(output: string): { exportName: string } | undefined {
  const match = /import \{ (\w+) \} from '\.\/[^']+\.js';/.exec(output);
  return match?.[1] !== undefined ? { exportName: match[1] } : undefined;
}

async function rebuildResearchStore(): Promise<void> {
  const result = await runCommand('yarn', ['workspace', '@quant-fusion/research-store', 'build'], {
    cwd: RESEARCH_STORE_PACKAGE_DIR,
  });
  if (!result.ok) {
    throw new Error(`rebuilding research-store failed:\n${result.output}`);
  }
}

/** Fires `rebuildResearchStore()` WITHOUT awaiting it, so every one of this file's "generate a
 * migration, register it, rebuild" functions can return its result to the caller — and the route
 * handler can flush the HTTP response — before the rebuild (a `tsc` recompile that overwrites
 * `dist/index.js`, this package's own resolved import target for `apps/api`) has a
 * chance to run. When this API is started via `tsx watch` (the host-run dev flow), that file
 * changing mid-request kills and restarts the whole process, dropping the in-flight response —
 * every single successful entity/relationship add produced a client-side "Failed to fetch" this
 * way, 100% reproducibly, before this fix. The migration file + its `index.ts` registration are
 * ALREADY durable by the time this is called (see `applyResearchUpdate`'s own comment on why) — the
 * rebuild only affects how soon a FUTURE read picks it up, so it's safe to let it finish after the
 * response instead of before it. A rebuild failure is logged, never thrown — it can't retroactively
 * un-succeed an update whose migration file is already on disk. */
function rebuildResearchStoreInBackground(): void {
  rebuildResearchStore().catch((error: unknown) => {
    console.error(
      `rebuildResearchStore failed after a successful update (a future read may lag until this is fixed): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  });
}

export interface ApplyResearchUpdateResult {
  ok: boolean;
  output: string;
  newVersion?: string;
  note?: string;
  error?: string;
}

/** Runs the update JSON through `@quant-fusion/research-store`'s own generic
 * `apply:research-update` script — the exact command a person following either research-update
 * skill's usage comment would run — never re-implemented here, so this route can never
 * validate/merge differently than that script does. On success it does the "one manual step"
 * (register the generated migration + rebuild) the script itself stops short of. Works for ANY
 * registered domain, not just fusion — `domain` comes straight from the URL. */
export async function applyResearchUpdate(
  domain: string,
  update: unknown,
): Promise<ApplyResearchUpdateResult> {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'sm4-research-update-'));
  try {
    const updateFilePath = path.join(tempDir, 'update.json');
    await writeFile(updateFilePath, JSON.stringify(update), 'utf8');

    const result = await runResearchStoreScript([
      'apply:research-update',
      '--',
      '--update-file',
      updateFilePath,
      '--domain',
      domain,
    ]);
    if (!result.ok) {
      const refusedMatch = /Update refused: (.*)/.exec(result.output);
      return {
        ok: false,
        output: result.output,
        error: refusedMatch?.[1] ?? 'The update was refused — see output for details.',
      };
    }

    const wroteMatch = /Wrote (.*[/\\](\d+)_research_update\.ts) \(version -> "([^"]+)"\)/.exec(
      result.output,
    );
    const generated = parseGeneratedImport(result.output);
    if (wroteMatch?.[2] === undefined || wroteMatch[3] === undefined || generated === undefined) {
      throw new Error(
        `apply:research-update exited successfully but its output wasn't in the expected shape:\n${result.output}`,
      );
    }
    const migrationNumber = wroteMatch[2];
    const newVersion = wroteMatch[3];
    await registerMigration(
      RESEARCH_STORE_MIGRATIONS_INDEX,
      `import { ${generated.exportName} } from './${migrationNumber}_research_update.js';`,
      generated.exportName,
    );
    rebuildResearchStoreInBackground();

    return {
      ok: true,
      output: result.output,
      newVersion,
      note:
        'Applied — saved to a new migration, no restart needed. The rebuild that makes a FUTURE ' +
        'read reflect it runs in the background and usually finishes in well under a second, but ' +
        'a read that races it very closely could still see the prior version once.',
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export interface TrackedTicker {
  ticker: string;
  companyName: string;
  addedAt: string;
}

export type ListTrackedTickersResult =
  { ok: true; tickers: TrackedTicker[] } | { ok: false; error: string };

/** A domain's news watchlist — see `@quant-fusion/research-store`'s
 * `migrations/0009_tracked_tickers_table.ts` for why this is separate from the domain's dataset
 * content. A domain that doesn't exist is a normal `{ok: false}` outcome, not a thrown error. */
export async function listTrackedTickers(domain: string): Promise<ListTrackedTickersResult> {
  const result = await runResearchStoreScript(['print:tracked-tickers', '--', '--domain', domain]);
  if (!result.ok) {
    throw new Error(`print:tracked-tickers failed:\n${result.output}`);
  }
  return JSON.parse(result.stdout) as ListTrackedTickersResult;
}

export interface ManageTrackedTickerResult {
  ok: boolean;
  output: string;
  error?: string;
}

async function manageTrackedTicker(args: string[]): Promise<ManageTrackedTickerResult> {
  const result = await runResearchStoreScript(['manage:tracked-ticker', '--', ...args]);
  if (!result.ok) {
    const refusedMatch = /Refused: (.*)/.exec(result.output);
    return {
      ok: false,
      output: result.output,
      error: refusedMatch?.[1] ?? 'The ticker could not be updated — see output for details.',
    };
  }

  const generated = parseGeneratedImport(result.output);
  if (generated === undefined) {
    throw new Error(
      `manage:tracked-ticker exited successfully but its output wasn't in the expected shape:\n${result.output}`,
    );
  }
  const wroteMatch = /Wrote (.*\.ts)\./.exec(result.output);
  if (wroteMatch?.[1] === undefined) {
    throw new Error(
      `manage:tracked-ticker exited successfully but its output wasn't in the expected shape:\n${result.output}`,
    );
  }
  const migrationFileName = path.basename(wroteMatch[1]);
  await registerMigration(
    RESEARCH_STORE_MIGRATIONS_INDEX,
    `import { ${generated.exportName} } from './${migrationFileName.replace(/\.ts$/, '.js')}';`,
    generated.exportName,
  );
  rebuildResearchStoreInBackground();

  return { ok: true, output: result.output };
}

/** Adds a ticker to `domain`'s news watchlist via `@quant-fusion/research-store`'s own
 * `manage:tracked-ticker` script. */
export async function addTrackedTicker(
  domain: string,
  ticker: string,
  companyName: string,
): Promise<ManageTrackedTickerResult> {
  return manageTrackedTicker([
    '--action',
    'add',
    '--domain',
    domain,
    '--ticker',
    ticker,
    '--company-name',
    companyName,
  ]);
}

/** Removes a ticker from `domain`'s news watchlist. Never touches any research entity/evidence
 * already citing it — see `tracked_tickers`'s own doc comment for why. */
export async function removeTrackedTicker(
  domain: string,
  ticker: string,
): Promise<ManageTrackedTickerResult> {
  return manageTrackedTicker(['--action', 'remove', '--domain', domain, '--ticker', ticker]);
}

export interface EventType {
  type: string;
  addedAt: string;
  eventCount: number;
}

export type ListEventTypesResult =
  { ok: true; eventTypes: EventType[] } | { ok: false; error: string };

/** A domain's registered event-type taxonomy — see `@quant-fusion/research-store`'s
 * `migrations/0034_event_types_table.ts` for why this is separate from the `type` values already
 * recorded on actual events. A domain that doesn't exist is a normal `{ok: false}` outcome, not a
 * thrown error. */
export async function listEventTypes(domain: string): Promise<ListEventTypesResult> {
  const result = await runResearchStoreScript(['print:event-types', '--', '--domain', domain]);
  if (!result.ok) {
    throw new Error(`print:event-types failed:\n${result.output}`);
  }
  return JSON.parse(result.stdout) as ListEventTypesResult;
}

export interface ManageEventTypeResult {
  ok: boolean;
  output: string;
  error?: string;
}

async function manageEventType(args: string[]): Promise<ManageEventTypeResult> {
  const result = await runResearchStoreScript(['manage:event-type', '--', ...args]);
  if (!result.ok) {
    const refusedMatch = /Refused: (.*)/.exec(result.output);
    return {
      ok: false,
      output: result.output,
      error: refusedMatch?.[1] ?? 'The event type could not be updated — see output for details.',
    };
  }

  const generated = parseGeneratedImport(result.output);
  if (generated === undefined) {
    throw new Error(
      `manage:event-type exited successfully but its output wasn't in the expected shape:\n${result.output}`,
    );
  }
  const wroteMatch = /Wrote (.*\.ts)\./.exec(result.output);
  if (wroteMatch?.[1] === undefined) {
    throw new Error(
      `manage:event-type exited successfully but its output wasn't in the expected shape:\n${result.output}`,
    );
  }
  const migrationFileName = path.basename(wroteMatch[1]);
  await registerMigration(
    RESEARCH_STORE_MIGRATIONS_INDEX,
    `import { ${generated.exportName} } from './${migrationFileName.replace(/\.ts$/, '.js')}';`,
    generated.exportName,
  );
  rebuildResearchStoreInBackground();

  return { ok: true, output: result.output };
}

/** Registers a new event type for `domain` via `@quant-fusion/research-store`'s own
 * `manage:event-type` script. */
export async function addEventType(domain: string, type: string): Promise<ManageEventTypeResult> {
  return manageEventType(['--action', 'add', '--domain', domain, '--type', type]);
}

/** Renames a registered event type. Never touches any event already recorded with the old type
 * string — see `@quant-fusion/research-store`'s `event_types` table doc comment for why. */
export async function renameEventType(
  domain: string,
  type: string,
  newType: string,
): Promise<ManageEventTypeResult> {
  return manageEventType([
    '--action',
    'rename',
    '--domain',
    domain,
    '--type',
    type,
    '--new-type',
    newType,
  ]);
}

/** De-registers an event type. Never touches any event already recorded with this type string —
 * it simply stops being an option for a NEW event until (if ever) re-added. */
export async function deleteEventType(
  domain: string,
  type: string,
): Promise<ManageEventTypeResult> {
  return manageEventType(['--action', 'delete', '--domain', domain, '--type', type]);
}

export interface EntityType {
  type: string;
  addedAt: string;
  entityCount: number;
}

export type ListEntityTypesResult =
  { ok: true; entityTypes: EntityType[] } | { ok: false; error: string };

/** A domain's registered entity-type taxonomy — see `@quant-fusion/research-store`'s
 * `migrations/0036_entity_types_table.ts` for why this is separate from the `type` values already
 * recorded on actual entities. A domain that doesn't exist is a normal `{ok: false}` outcome, not
 * a thrown error. */
export async function listEntityTypes(domain: string): Promise<ListEntityTypesResult> {
  const result = await runResearchStoreScript(['print:entity-types', '--', '--domain', domain]);
  if (!result.ok) {
    throw new Error(`print:entity-types failed:\n${result.output}`);
  }
  return JSON.parse(result.stdout) as ListEntityTypesResult;
}

export interface ManageEntityTypeResult {
  ok: boolean;
  output: string;
  error?: string;
}

async function manageEntityType(args: string[]): Promise<ManageEntityTypeResult> {
  const result = await runResearchStoreScript(['manage:entity-type', '--', ...args]);
  if (!result.ok) {
    const refusedMatch = /Refused: (.*)/.exec(result.output);
    return {
      ok: false,
      output: result.output,
      error: refusedMatch?.[1] ?? 'The entity type could not be updated — see output for details.',
    };
  }

  const generated = parseGeneratedImport(result.output);
  if (generated === undefined) {
    throw new Error(
      `manage:entity-type exited successfully but its output wasn't in the expected shape:\n${result.output}`,
    );
  }
  const wroteMatch = /Wrote (.*\.ts)\./.exec(result.output);
  if (wroteMatch?.[1] === undefined) {
    throw new Error(
      `manage:entity-type exited successfully but its output wasn't in the expected shape:\n${result.output}`,
    );
  }
  const migrationFileName = path.basename(wroteMatch[1]);
  await registerMigration(
    RESEARCH_STORE_MIGRATIONS_INDEX,
    `import { ${generated.exportName} } from './${migrationFileName.replace(/\.ts$/, '.js')}';`,
    generated.exportName,
  );
  rebuildResearchStoreInBackground();

  return { ok: true, output: result.output };
}

/** Registers a new entity type for `domain` via `@quant-fusion/research-store`'s own
 * `manage:entity-type` script. */
export async function addEntityType(domain: string, type: string): Promise<ManageEntityTypeResult> {
  return manageEntityType(['--action', 'add', '--domain', domain, '--type', type]);
}

/** Renames a registered entity type. Never touches any entity already recorded with the old type
 * string — see `@quant-fusion/research-store`'s `entity_types` table doc comment for why. */
export async function renameEntityType(
  domain: string,
  type: string,
  newType: string,
): Promise<ManageEntityTypeResult> {
  return manageEntityType([
    '--action',
    'rename',
    '--domain',
    domain,
    '--type',
    type,
    '--new-type',
    newType,
  ]);
}

/** De-registers an entity type. Never touches any entity already recorded with this type string —
 * it simply stops being an option for a NEW or edited entity until (if ever) re-added. */
export async function deleteEntityType(
  domain: string,
  type: string,
): Promise<ManageEntityTypeResult> {
  return manageEntityType(['--action', 'delete', '--domain', domain, '--type', type]);
}

/** The only categories a relationship type can be sorted into — one-for-one the four Exposure Map
 * dimensions `@quant-fusion/quant-sdk-js`'s own `computeExposureMap` classifies relationships
 * into by type (`manufacturing`/`qualification`/`contract`/`program` — see that function's own
 * doc comment; `architecture`/`material`/`component` classify by ENTITY type instead, and
 * `bottleneck` by hypothesis, so a relationship type can't be sorted into those). A person picks
 * one of these four rather than inventing an arbitrary label — see `quantAnalysis.ts`'s own
 * `applyRelationshipTypeCategories` doc comment for how a pick actually affects the Exposure Map.
 * Defined here (not in `quantAnalysis.ts`, which is conceptually where this belongs) because
 * `routes/research.ts`'s PATCH validation needs it too, and `quantAnalysis.ts` already imports
 * from this file — importing back would be circular. */
export const RELATIONSHIP_TYPE_CATEGORIES = [
  'manufacturing',
  'qualification',
  'contract',
  'program',
] as const;
export type RelationshipTypeCategory = (typeof RELATIONSHIP_TYPE_CATEGORIES)[number];

export function isRelationshipTypeCategory(value: string): value is RelationshipTypeCategory {
  return (RELATIONSHIP_TYPE_CATEGORIES as readonly string[]).includes(value);
}

export interface RelationshipType {
  type: string;
  addedAt: string;
  relationshipCount: number;
  /** Which Exposure Map category this type has been sorted into — purely UI categorization (see
   * `@quant-fusion/research-store`'s `migrations/0041_relationship_types_category_column.ts`),
   * never read by `@quant-fusion/quant-sdk-js`'s own exposure computation. `undefined` means not
   * sorted into one yet. */
  category?: RelationshipTypeCategory;
}

export type ListRelationshipTypesResult =
  { ok: true; relationshipTypes: RelationshipType[] } | { ok: false; error: string };

/** A domain's registered relationship-type taxonomy — see `@quant-fusion/research-store`'s
 * `migrations/0038_relationship_types_table.ts` for why this is separate from the `type` values
 * already recorded on actual relationships. A domain that doesn't exist is a normal `{ok: false}`
 * outcome, not a thrown error. */
export async function listRelationshipTypes(domain: string): Promise<ListRelationshipTypesResult> {
  const result = await runResearchStoreScript([
    'print:relationship-types',
    '--',
    '--domain',
    domain,
  ]);
  if (!result.ok) {
    throw new Error(`print:relationship-types failed:\n${result.output}`);
  }
  return JSON.parse(result.stdout) as ListRelationshipTypesResult;
}

export interface ManageRelationshipTypeResult {
  ok: boolean;
  output: string;
  error?: string;
}

async function manageRelationshipType(args: string[]): Promise<ManageRelationshipTypeResult> {
  const result = await runResearchStoreScript(['manage:relationship-type', '--', ...args]);
  if (!result.ok) {
    const refusedMatch = /Refused: (.*)/.exec(result.output);
    return {
      ok: false,
      output: result.output,
      error:
        refusedMatch?.[1] ?? 'The relationship type could not be updated — see output for details.',
    };
  }

  const generated = parseGeneratedImport(result.output);
  if (generated === undefined) {
    throw new Error(
      `manage:relationship-type exited successfully but its output wasn't in the expected shape:\n${result.output}`,
    );
  }
  const wroteMatch = /Wrote (.*\.ts)\./.exec(result.output);
  if (wroteMatch?.[1] === undefined) {
    throw new Error(
      `manage:relationship-type exited successfully but its output wasn't in the expected shape:\n${result.output}`,
    );
  }
  const migrationFileName = path.basename(wroteMatch[1]);
  await registerMigration(
    RESEARCH_STORE_MIGRATIONS_INDEX,
    `import { ${generated.exportName} } from './${migrationFileName.replace(/\.ts$/, '.js')}';`,
    generated.exportName,
  );
  rebuildResearchStoreInBackground();

  return { ok: true, output: result.output };
}

/** Registers a new relationship type for `domain` via `@quant-fusion/research-store`'s own
 * `manage:relationship-type` script. */
export async function addRelationshipType(
  domain: string,
  type: string,
): Promise<ManageRelationshipTypeResult> {
  return manageRelationshipType(['--action', 'add', '--domain', domain, '--type', type]);
}

/** Renames a registered relationship type. Never touches any relationship already recorded with
 * the old type string — see `@quant-fusion/research-store`'s `relationship_types` table doc
 * comment for why. */
export async function renameRelationshipType(
  domain: string,
  type: string,
  newType: string,
): Promise<ManageRelationshipTypeResult> {
  return manageRelationshipType([
    '--action',
    'rename',
    '--domain',
    domain,
    '--type',
    type,
    '--new-type',
    newType,
  ]);
}

/** De-registers a relationship type. Never touches any relationship already recorded with this
 * type string — it simply stops being an option for a NEW relationship until (if ever) re-added. */
export async function deleteRelationshipType(
  domain: string,
  type: string,
): Promise<ManageRelationshipTypeResult> {
  return manageRelationshipType(['--action', 'delete', '--domain', domain, '--type', type]);
}

/** Sorts a registered relationship type into `category`, or (when `category` is `null`) un-sorts
 * it — purely UI categorization for the Quant tab's Exposure Map, never read by
 * `@quant-fusion/quant-sdk-js`'s own exposure computation. See
 * `@quant-fusion/research-store`'s `relationship_types.category` column doc comment. Callers MUST
 * validate `category` against `RELATIONSHIP_TYPE_CATEGORIES` themselves (via
 * `isRelationshipTypeCategory`) before calling this — it forwards whatever string it's given. */
export async function setRelationshipTypeCategory(
  domain: string,
  type: string,
  category: RelationshipTypeCategory | null,
): Promise<ManageRelationshipTypeResult> {
  return category === null
    ? manageRelationshipType(['--action', 'clear-category', '--domain', domain, '--type', type])
    : manageRelationshipType([
        '--action',
        'set-category',
        '--domain',
        domain,
        '--type',
        type,
        '--category',
        category,
      ]);
}

/** Every registered relationship type that's been sorted into a category, as a `type -> category`
 * lookup — the input `@quant-fusion/quant-sdk-js`'s own exposure computation NEVER sees; only
 * `quantAnalysis.ts`'s own `applyRelationshipTypeCategories` reads this, to decide which Exposure
 * Map dimension a target entity's relationship counts toward. */
export async function listRelationshipTypeCategoryAssignments(
  domain: string,
): Promise<
  { ok: true; categoryByType: Map<string, RelationshipTypeCategory> } | { ok: false; error: string }
> {
  const result = await listRelationshipTypes(domain);
  if (!result.ok) return result;

  const categoryByType = new Map<string, RelationshipTypeCategory>();
  for (const t of result.relationshipTypes) {
    if (t.category === undefined) continue;
    categoryByType.set(t.type, t.category);
  }
  return { ok: true, categoryByType };
}

export type DeletableResearchCollection = 'entities' | 'relationships' | 'hypotheses';

export interface DeleteResearchItemResult {
  ok: boolean;
  output: string;
  error?: string;
}

/** Deletes one entity/relationship/hypothesis by id via `@quant-fusion/research-store`'s own
 * `delete:research-item` script — see that script's own doc comment for why only these three
 * collections are deletable, and why this is a real `DELETE`, not a retraction. Same "generate a
 * migration, register it, rebuild" pattern as `manageTrackedTicker` above. */
export async function deleteResearchItem(
  domain: string,
  collection: DeletableResearchCollection,
  id: string,
): Promise<DeleteResearchItemResult> {
  const result = await runResearchStoreScript([
    'delete:research-item',
    '--',
    '--domain',
    domain,
    '--collection',
    collection,
    '--id',
    id,
  ]);
  if (!result.ok) {
    const refusedMatch = /Refused: (.*)/.exec(result.output);
    return {
      ok: false,
      output: result.output,
      error: refusedMatch?.[1] ?? 'The item could not be deleted — see output for details.',
    };
  }

  const generated = parseGeneratedImport(result.output);
  if (generated === undefined) {
    throw new Error(
      `delete:research-item exited successfully but its output wasn't in the expected shape:\n${result.output}`,
    );
  }
  const wroteMatch = /Wrote (.*\.ts)\./.exec(result.output);
  if (wroteMatch?.[1] === undefined) {
    throw new Error(
      `delete:research-item exited successfully but its output wasn't in the expected shape:\n${result.output}`,
    );
  }
  const migrationFileName = path.basename(wroteMatch[1]);
  await registerMigration(
    RESEARCH_STORE_MIGRATIONS_INDEX,
    `import { ${generated.exportName} } from './${migrationFileName.replace(/\.ts$/, '.js')}';`,
    generated.exportName,
  );
  rebuildResearchStoreInBackground();

  return { ok: true, output: result.output };
}

export interface CreateResearchDomainResult {
  ok: boolean;
  output: string;
  domain?: string;
  datasetId?: string;
  error?: string;
}

/** Creates a brand-new, EMPTY research domain via `@quant-fusion/research-store`'s own
 * `create:domain` script — see that script's own doc comment for why a new domain no longer needs
 * a whole new package the way `research-fusion`/`research-quantum` do. */
export async function createResearchDomain(
  name: string,
  domain?: string,
  priority?: number,
): Promise<CreateResearchDomainResult> {
  const result = await runResearchStoreScript([
    'create:domain',
    '--',
    '--name',
    name,
    ...(domain !== undefined ? ['--domain', domain] : []),
    ...(priority !== undefined ? ['--priority', String(priority)] : []),
  ]);
  if (!result.ok) {
    const refusedMatch = /Refused: (.*)/.exec(result.output);
    return {
      ok: false,
      output: result.output,
      error: refusedMatch?.[1] ?? 'The domain could not be created — see output for details.',
    };
  }

  const createdMatch = /Created domain "([^"]+)" \(dataset "([^"]+)"\)\./.exec(result.output);
  const wroteMatch = /Wrote (.*[/\\](\d+)_[a-z0-9_]+_seed\.ts)/.exec(result.output);
  const generated = parseGeneratedImport(result.output);
  if (
    createdMatch?.[1] === undefined ||
    createdMatch[2] === undefined ||
    wroteMatch?.[1] === undefined ||
    generated === undefined
  ) {
    throw new Error(
      `create:domain exited successfully but its output wasn't in the expected shape:\n${result.output}`,
    );
  }
  const migrationFileName = path.basename(wroteMatch[1]);
  await registerMigration(
    RESEARCH_STORE_MIGRATIONS_INDEX,
    `import { ${generated.exportName} } from './${migrationFileName.replace(/\.ts$/, '.js')}';`,
    generated.exportName,
  );
  rebuildResearchStoreInBackground();

  return {
    ok: true,
    output: result.output,
    domain: createdMatch[1],
    datasetId: createdMatch[2],
  };
}
