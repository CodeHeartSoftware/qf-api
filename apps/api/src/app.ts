import express, { type Express } from 'express';
import { createBotsRouter } from './routes/bots.js';
import { createForwardMatchesRouter } from './routes/forwardMatches.js';
import { createJobsRouter } from './routes/jobs.js';
import { createLiveRouter } from './routes/live.js';
import { createLlmRouter } from './routes/llm.js';
import { createMarketDataRouter } from './routes/marketData.js';
import { createMatchesRouter } from './routes/matches.js';
import { createNewsRouter } from './routes/news.js';
import { createResearchRouter } from './routes/research.js';
import { createSettingsRouter } from './routes/settings.js';

/** Phase A (see `docs/adr/0015-quant-fusion-ui-read-api.md`) was every route here being
 * read-only (GET, no mutation). Phase B adds a handful of mutating POST actions (forward-match
 * run/preview, a market-data fetch job) — see that ADR's own Phase B note — each one spawning
 * `apps/cli`'s own real, already-tested commands as a child process rather than duplicating
 * Docker/game execution logic here. `rootDir` is the monorepo root, the same `process.cwd()`-
 * rooted convention `apps/cli` uses for resolving the shared SQLite file and the
 * `bots/stock-market-4/*` directory. */
export function createApp(rootDir: string): Express {
  const app = express();

  // Local-dev-only CORS: the UI (`quant-fusion-ui`, a separate Vite dev server/origin)
  // fetches this API directly. No credentials/cookies are involved, so a blanket allow-origin is
  // fine for a single-developer local tool — revisit if this API is ever exposed beyond localhost.
  // A Phase B action's `fetch(..., { method: 'POST', headers: { 'content-type': 'application/json' } })`
  // isn't a CORS-simple request (that content-type isn't in the safelist), so the browser sends an
  // OPTIONS preflight first and refuses the real request unless that preflight itself answers with
  // Allow-Methods/Allow-Headers too — Express's own default OPTIONS handling doesn't add those, it
  // only inherited Allow-Origin from this middleware, so every Phase B POST failed in the browser
  // (never in curl, which skips preflights entirely) until this handled OPTIONS explicitly.
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    // DELETE added alongside the tracked-tickers "remove" route (`research.ts`'s
    // `DELETE /:domain/tickers/:ticker`) — missed at the time, which would have silently broken
    // that button in a real browser exactly like the original bare-Allow-Origin bug did for POST
    // (curl never surfaces this either, since it skips preflights entirely). PATCH added
    // alongside the event-types "rename" route (`research.ts`'s `PATCH /:domain/event-types/:type`)
    // for the same reason.
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });
  app.use(express.json());

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/bots', createBotsRouter(rootDir));
  app.use('/api/forward-matches', createForwardMatchesRouter(rootDir));
  app.use('/api/jobs', createJobsRouter(rootDir));
  app.use('/api/market-data', createMarketDataRouter(rootDir));
  app.use('/api/matches', createMatchesRouter(rootDir));
  app.use('/api/research', createResearchRouter(rootDir));
  app.use('/api/news', createNewsRouter());
  app.use('/api/llm', createLlmRouter(rootDir));
  app.use('/api/live', createLiveRouter(rootDir));
  app.use('/api/settings', createSettingsRouter(rootDir));

  return app;
}
