import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { findMarketUniverse, MARKET_UNIVERSES, type MarketUniverse } from './marketUniverses.js';

/**
 * User-added market universes — kept separate from `marketUniverses.ts`'s own `MARKET_UNIVERSES`
 * (that file's array is hand-maintained source, not meant for runtime mutation; see its own doc
 * comment on "adding one later is a registry entry, not a redesign" — this is that redesign, for
 * universes a person defines from the Create Match modal rather than a developer editing code).
 *
 * A plain JSON file, not a SQLite-migration store like `research-store`'s taxonomies: a market
 * universe has no "what did we believe was true as of X" history worth preserving — renaming or
 * removing one is just a direct edit, so there's no reason to carry the migration-per-mutation
 * machinery research content needs. Every entry's `datasetId`/`datasetVersion` is always inherited
 * from an EXISTING universe (never hand-typed) — see `routes/marketData.ts`'s own `POST
 * /universes` doc comment for why.
 */
function customUniversesPath(rootDir: string): string {
  return path.join(rootDir, '.quant-fusion', 'custom-universes.json');
}

async function readCustomUniverses(rootDir: string): Promise<MarketUniverse[]> {
  try {
    const raw = await readFile(customUniversesPath(rootDir), 'utf8');
    return JSON.parse(raw) as MarketUniverse[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export async function listCustomUniverses(rootDir: string): Promise<MarketUniverse[]> {
  return readCustomUniverses(rootDir);
}

/** Every registered universe, built-in and custom — the one place a caller should look up "does
 * this universeId exist" (built-ins first, so a custom universe can never shadow one). */
export async function resolveMarketUniverse(
  rootDir: string,
  id: string,
): Promise<MarketUniverse | undefined> {
  const builtIn = findMarketUniverse(id);
  if (builtIn !== undefined) return builtIn;
  const custom = await readCustomUniverses(rootDir);
  return custom.find((u) => u.id === id);
}

export interface AddCustomUniverseInput {
  id: string;
  label: string;
  datasetId: string;
  datasetVersion: string;
  tickers: string[];
}

export type AddCustomUniverseResult =
  { ok: true; universe: MarketUniverse } | { ok: false; error: string };

/** Appends one new universe to the JSON file — refuses (never overwrites) an id already used by
 * either a built-in or an existing custom universe. `game` is always `'stock-market-4'`: every
 * universe this app can create today is for that one game (see `MARKET_UNIVERSES`'s own doc
 * comment on why a second game's registry entry is future work, not something this input needs to
 * express yet). */
export async function addCustomUniverse(
  rootDir: string,
  input: AddCustomUniverseInput,
): Promise<AddCustomUniverseResult> {
  const trimmedId = input.id.trim();
  const trimmedLabel = input.label.trim();
  if (trimmedId === '') return { ok: false, error: 'id must be a non-empty string' };
  if (trimmedLabel === '') return { ok: false, error: 'label must be a non-empty string' };
  if (input.tickers.length === 0) return { ok: false, error: 'tickers must be a non-empty array' };

  const existing = await readCustomUniverses(rootDir);
  if (findMarketUniverse(trimmedId) !== undefined || existing.some((u) => u.id === trimmedId)) {
    return { ok: false, error: `a market universe with id "${trimmedId}" already exists` };
  }

  const universe: MarketUniverse = {
    id: trimmedId,
    game: 'stock-market-4',
    label: trimmedLabel,
    datasetId: input.datasetId,
    datasetVersion: input.datasetVersion,
    tickers: input.tickers,
  };
  const filePath = customUniversesPath(rootDir);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify([...existing, universe], null, 2), 'utf8');

  return { ok: true, universe };
}

/** Every registered universe, built-in first — the shape `GET /api/market-data/universes` already
 * returns; used wherever the FULL list (not just a by-id lookup) is needed. */
export async function listAllMarketUniverses(rootDir: string): Promise<MarketUniverse[]> {
  return [...MARKET_UNIVERSES, ...(await listCustomUniverses(rootDir))];
}
