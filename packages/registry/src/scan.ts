// The bot/game registry: a pure filesystem scan, never a hand-maintained index
// (docs/adr/0001-monorepo-and-boundary.md §"Manifests"). Reading a competitor's metadata must
// never require executing their code — this module only ever reads and JSON.parses
// manifest.json files; it never imports a bot's or game's actual source.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { BotManifestSchema, type BotManifest } from '@quant-fusion/bot-sdk-js';
import { GameManifestSchema, type GameManifest } from '@quant-fusion/game-sdk';

export interface RegistryIssue {
  path: string;
  message: string;
}

export interface GameRegistryEntry {
  manifest: GameManifest;
  /** This game's directory (contains manifest.json, package.json, src/). */
  dir: string;
}

export interface BotRegistryEntry {
  manifest: BotManifest;
  /** This bot's directory (contains manifest.json, Dockerfile, ...). */
  dir: string;
}

export interface ScanResult<TEntry> {
  entries: Map<string, TEntry>;
  issues: RegistryIssue[];
}

async function readManifest(manifestPath: string): Promise<unknown> {
  try {
    const raw = await readFile(manifestPath, 'utf8');
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

async function listSubdirectories(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return []; // dir doesn't exist yet — an empty registry, not an error
  }
}

/**
 * Scans games/<game-id>/manifest.json, validating each with GameManifestSchema. A broken
 * manifest is collected as an issue and excluded from `entries` — it never crashes the scan for
 * unrelated games. A duplicate id keeps the first entry found and records an issue for the rest.
 */
export async function scanGames(rootDir: string): Promise<ScanResult<GameRegistryEntry>> {
  const gamesDir = path.join(rootDir, 'games');
  const entries = new Map<string, GameRegistryEntry>();
  const issues: RegistryIssue[] = [];

  for (const dirName of await listSubdirectories(gamesDir)) {
    const dir = path.join(gamesDir, dirName);
    const manifestPath = path.join(dir, 'manifest.json');
    const raw = await readManifest(manifestPath);
    if (raw === undefined) {
      issues.push({ path: manifestPath, message: 'missing or unreadable manifest.json' });
      continue;
    }
    const result = GameManifestSchema.safeParse(raw);
    if (!result.success) {
      issues.push({ path: manifestPath, message: result.error.message });
      continue;
    }
    if (entries.has(result.data.id)) {
      issues.push({ path: manifestPath, message: `duplicate game id "${result.data.id}"` });
      continue;
    }
    entries.set(result.data.id, { manifest: result.data, dir });
  }

  return { entries, issues };
}

/**
 * Scans bots/<game-id>/<bot-id>/manifest.json, validating each with BotManifestSchema and
 * cross-checking that the manifest's own `game` field agrees with the <game-id> directory it's
 * grouped under — enforced at registry-load time, since nothing stops a manifest from being hand-edited after merge.
 */
export async function scanBots(rootDir: string): Promise<ScanResult<BotRegistryEntry>> {
  const botsDir = path.join(rootDir, 'bots');
  const entries = new Map<string, BotRegistryEntry>();
  const issues: RegistryIssue[] = [];

  for (const gameDirName of await listSubdirectories(botsDir)) {
    const gameDir = path.join(botsDir, gameDirName);
    for (const botDirName of await listSubdirectories(gameDir)) {
      const dir = path.join(gameDir, botDirName);
      const manifestPath = path.join(dir, 'manifest.json');
      const raw = await readManifest(manifestPath);
      if (raw === undefined) {
        issues.push({ path: manifestPath, message: 'missing or unreadable manifest.json' });
        continue;
      }
      const result = BotManifestSchema.safeParse(raw);
      if (!result.success) {
        issues.push({ path: manifestPath, message: result.error.message });
        continue;
      }
      if (result.data.game !== gameDirName) {
        issues.push({
          path: manifestPath,
          message: `manifest game "${result.data.game}" does not match its directory grouping "${gameDirName}"`,
        });
        continue;
      }
      if (entries.has(result.data.id)) {
        issues.push({ path: manifestPath, message: `duplicate bot id "${result.data.id}"` });
        continue;
      }
      entries.set(result.data.id, { manifest: result.data, dir });
    }
  }

  return { entries, issues };
}
