import type { Request, Response, Router } from 'express';
import { Router as createRouter } from 'express';
import {
  getSettings,
  updateSettings,
  type DailyCycleSchedule,
  type SettingsUpdate,
  type StockMarket4Settings,
} from '../lib/settingsStore.js';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface SettingsStatusResponse {
  openaiApiKeyConfigured: boolean;
  /** Last 4 characters only, e.g. `"ab12"` — enough to recognize "yes that's the key I saved"
   * without ever re-exposing the full secret once it's been written. `undefined` when not
   * configured. */
  openaiApiKeyPreview?: string;
  dailyCycle?: DailyCycleSchedule;
}

function toStatusResponse(settings: StockMarket4Settings): SettingsStatusResponse {
  const key = settings.openaiApiKey;
  return {
    openaiApiKeyConfigured: key !== undefined && key.trim() !== '',
    ...(key !== undefined && key.trim() !== '' ? { openaiApiKeyPreview: key.slice(-4) } : {}),
    ...(settings.dailyCycle !== undefined ? { dailyCycle: settings.dailyCycle } : {}),
  };
}

function parseDailyCycle(value: unknown): DailyCycleSchedule | string {
  if (typeof value !== 'object' || value === null) return '"dailyCycle" must be an object.';
  const { enabled, timeLocal, matchIds } = value as Record<string, unknown>;
  if (typeof enabled !== 'boolean') return '"dailyCycle.enabled" must be a boolean.';
  if (typeof timeLocal !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(timeLocal)) {
    return '"dailyCycle.timeLocal" must be HH:MM (24h).';
  }
  if (!Array.isArray(matchIds) || !matchIds.every((id): id is string => typeof id === 'string')) {
    return '"dailyCycle.matchIds" must be an array of strings.';
  }
  return { enabled, timeLocal, matchIds };
}

/** App-wide Stock Market 4 settings (currently: the OpenAI API key the News Research Agent uses
 * to reach a paid/free-tier ChatGPT account — see `lib/settingsStore.ts`'s own doc comment on why
 * that's a platform.openai.com key, not a ChatGPT subscription). The raw key is write-only from
 * the client's perspective: `GET` never returns it, only whether one is configured and its last 4
 * characters, so the Settings tab can show "configured (...ab12)" without the full secret ever
 * round-tripping back to the browser after the initial save. */
export function createSettingsRouter(rootDir: string): Router {
  const router = createRouter();

  router.get('/', (_req: Request, res: Response) => {
    getSettings(rootDir)
      .then((settings) => {
        res.json(toStatusResponse(settings));
      })
      .catch((error: unknown) => {
        res.status(500).json({ error: errorMessage(error) });
      });
  });

  router.post('/', (req: Request, res: Response) => {
    const body: unknown = req.body;
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      res.status(400).json({ error: 'Request body must be a JSON object.' });
      return;
    }
    const fields = body as Record<string, unknown>;
    const update: SettingsUpdate = {};
    // Each field is only touched when present in the body — saving the schedule must never
    // clear the API key, and vice versa.
    if ('openaiApiKey' in fields) {
      const { openaiApiKey } = fields;
      if (openaiApiKey !== undefined && openaiApiKey !== null && typeof openaiApiKey !== 'string') {
        res.status(400).json({ error: '"openaiApiKey" must be a string, null, or omitted.' });
        return;
      }
      // `null` or an empty string both mean "clear it" — either is a natural thing for the
      // Settings tab's own "Clear" button to send.
      const trimmed = typeof openaiApiKey === 'string' ? openaiApiKey.trim() : openaiApiKey;
      update.openaiApiKey = trimmed === null || trimmed === '' ? undefined : trimmed;
    }
    if ('dailyCycle' in fields) {
      const parsed = parseDailyCycle(fields.dailyCycle);
      if (typeof parsed === 'string') {
        res.status(400).json({ error: parsed });
        return;
      }
      update.dailyCycle = parsed;
    }

    (async () => {
      // Keeps the scheduler's own "already fired today" marker across a schedule edit.
      if (update.dailyCycle !== undefined) {
        const lastTriggeredDate = (await getSettings(rootDir)).dailyCycle?.lastTriggeredDate;
        if (lastTriggeredDate !== undefined)
          update.dailyCycle = { ...update.dailyCycle, lastTriggeredDate };
      }
      return updateSettings(rootDir, update);
    })()
      .then((settings) => {
        res.json(toStatusResponse(settings));
      })
      .catch((error: unknown) => {
        res.status(500).json({ error: errorMessage(error) });
      });
  });

  return router;
}
