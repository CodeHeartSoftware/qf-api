import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defaultSettingsPath } from './paths.js';

export interface DailyCycleSchedule {
  enabled: boolean;
  /** Local wall-clock time, `HH:MM` (24h) — the cycle fires at the first scheduler tick at or
   * after this, once per weekday. */
  timeLocal: string;
  matchIds: string[];
  /** `YYYY-MM-DD` (local) the scheduler last fired — written by the scheduler itself, so an API
   * restart later the same day doesn't fire it twice. */
  lastTriggeredDate?: string;
}

export interface StockMarket4Settings {
  /** OpenAI platform API key (platform.openai.com) — distinct from a ChatGPT subscription, which
   * has no API of its own. Used by `lib/llm/openai.ts`. `undefined` means not configured. */
  openaiApiKey?: string;
  /** See `lib/dailyCycleScheduler.ts`. `undefined` means never configured (off). */
  dailyCycle?: DailyCycleSchedule;
}

/** Plain JSON on disk, read fresh every call — this app is a single local process with no
 * concurrent writers to race, and settings are read at most once per News Research Agent run, so
 * there's no reason to cache in memory and risk serving a stale value after a Settings tab save. */
export async function getSettings(rootDir: string): Promise<StockMarket4Settings> {
  try {
    const raw = await readFile(defaultSettingsPath(rootDir), 'utf8');
    return JSON.parse(raw) as StockMarket4Settings;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

/** A settings update explicitly allows `undefined` per field (unlike `Partial<...>` under this
 * project's `exactOptionalPropertyTypes`) — `updateSettings` treats an explicit `undefined` as
 * "remove this key," which `Partial` alone can't express once optional properties are exact. */
export type SettingsUpdate = {
  [K in keyof StockMarket4Settings]?: StockMarket4Settings[K] | undefined;
};

/** Merges `partial` into the existing settings — a key explicitly set to `undefined` is REMOVED
 * (lets the Settings tab's "Clear" action delete a key outright), never written as a literal
 * `null`/`"undefined"`. */
export async function updateSettings(
  rootDir: string,
  partial: SettingsUpdate,
): Promise<StockMarket4Settings> {
  const current = await getSettings(rootDir);
  const combined: Record<string, unknown> = { ...current, ...partial };
  const merged = Object.fromEntries(
    Object.entries(combined).filter((entry) => entry[1] !== undefined),
  ) as StockMarket4Settings;
  const settingsPath = defaultSettingsPath(rootDir);
  await mkdir(path.dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}
