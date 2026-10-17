import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Request, Response, Router } from 'express';
import { Router as createRouter } from 'express';
import { botsDir } from '../lib/paths.js';

export interface BotSummary {
  id: string;
  name: string;
  version: string;
  game: string;
  description: string;
}

interface RawManifest {
  id?: unknown;
  name?: unknown;
  version?: unknown;
  game?: unknown;
  description?: unknown;
}

function isRawManifest(value: unknown): value is RawManifest {
  return typeof value === 'object' && value !== null;
}

function toBotSummary(raw: unknown): BotSummary | undefined {
  if (!isRawManifest(raw)) return undefined;
  if (
    typeof raw.id !== 'string' ||
    typeof raw.name !== 'string' ||
    typeof raw.version !== 'string'
  ) {
    return undefined;
  }
  return {
    id: raw.id,
    name: raw.name,
    version: raw.version,
    game: typeof raw.game === 'string' ? raw.game : 'unknown',
    description: typeof raw.description === 'string' ? raw.description : '',
  };
}

/** Scans `bots/stock-market-4/*\/manifest.json` directly — no dependency on
 * `@quant-fusion/registry` (that package validates bots for real match execution; this route only
 * lists what's registered, so a plain directory scan is enough for Phase A). A bot directory
 * missing or with an unparseable manifest is skipped rather than failing the whole list. */
export async function listBots(rootDir: string): Promise<BotSummary[]> {
  const dir = botsDir(rootDir);
  let entries: string[];
  try {
    entries = await readdir(dir, { withFileTypes: false });
  } catch {
    return [];
  }

  const bots: BotSummary[] = [];
  for (const entry of entries.sort()) {
    const manifestPath = path.join(dir, entry, 'manifest.json');
    try {
      const raw = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown;
      const bot = toBotSummary(raw);
      if (bot !== undefined) bots.push(bot);
    } catch {
      // Not a bot directory (no manifest.json) or unparseable — skip it.
    }
  }
  return bots;
}

export function createBotsRouter(rootDir: string): Router {
  const router = createRouter();
  router.get('/', (_req: Request, res: Response) => {
    listBots(rootDir)
      .then((bots) => res.json({ bots }))
      .catch((error: unknown) => {
        res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
      });
  });
  return router;
}
