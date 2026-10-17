import type { Request, Response, Router } from 'express';
import { Router as createRouter } from 'express';
import { listTrackedTickers } from '../lib/researchStore.js';
import { fetchGoogleNews, type NewsItem } from '../lib/googleNewsRss.js';

const ITEMS_PER_TICKER = 6;

export interface TickerNewsFeed {
  ticker: string;
  companyName: string;
  items: NewsItem[];
  error?: string;
}

/** Read-only, no dataset write (deliberately, for now — see docs/adr/0015's own note on this):
 * a plain news fetch can automate FINDING real news with zero LLM tokens, but deciding whether a
 * headline is actually a new relationship/event worth adding to the research model needs
 * judgment this endpoint doesn't attempt. That stays the `portfolio-research-update-skill.md`
 * pipeline's job; this is raw material for it (or for a person) to look at, not a replacement.
 *
 * Scoped by research domain — each domain has its own news watchlist
 * (`@quant-fusion/research-store`'s `tracked_tickers`, managed via `/api/research/:domain/tickers`)
 * rather than one hardcoded, fusion-only ticker list, so a domain with no tracked tickers (e.g. a
 * freshly created one, or `quantum`) correctly shows no articles instead of every other domain's. */
export function createNewsRouter(): Router {
  const router = createRouter();

  router.get('/:domain', (req: Request, res: Response) => {
    const { domain } = req.params;
    if (domain === undefined) {
      res.status(400).json({ error: 'domain is required.' });
      return;
    }

    listTrackedTickers(domain)
      .then(async (tickersResult) => {
        if (!tickersResult.ok) {
          res.status(404).json({ error: tickersResult.error });
          return;
        }

        const feeds = await Promise.all(
          tickersResult.tickers.map(async (tracked): Promise<TickerNewsFeed> => {
            const base = { ticker: tracked.ticker, companyName: tracked.companyName };
            try {
              const items = await fetchGoogleNews(`"${tracked.companyName}"`, ITEMS_PER_TICKER);
              return { ...base, items };
            } catch (error) {
              return {
                ...base,
                items: [],
                error: error instanceof Error ? error.message : String(error),
              };
            }
          }),
        );
        res.json({ feeds, fetchedAt: new Date().toISOString() });
      })
      .catch((error: unknown) => {
        res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
      });
  });

  return router;
}
