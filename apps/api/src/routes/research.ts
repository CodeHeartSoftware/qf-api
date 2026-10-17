import type { Request, Response, Router } from 'express';
import { Router as createRouter } from 'express';
import {
  addEntityType,
  addEventType,
  addRelationshipType,
  addTrackedTicker,
  applyResearchUpdate,
  createResearchDomain,
  deleteEntityType,
  deleteEventType,
  deleteRelationshipType,
  deleteResearchItem,
  isRelationshipTypeCategory,
  listEntityTypes,
  listEventTypes,
  listRelationshipTypes,
  listResearchDomains,
  listTrackedTickers,
  loadResearchDataset,
  RELATIONSHIP_TYPE_CATEGORIES,
  removeTrackedTicker,
  renameEntityType,
  renameEventType,
  renameRelationshipType,
  setRelationshipTypeCategory,
} from '../lib/researchStore.js';
import type { LlmProvider } from '../lib/llm/index.js';
import { runNewsAgent } from '../lib/newsAgent.js';
import { getExposureMap, getResearchDelta, getThesisGroups } from '../lib/quantAnalysis.js';
import { isLocked, withLock } from '../lib/subprocess.js';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Every route here is generic across whatever research domains
 * `@quant-fusion/research-store`'s own `research_datasets` table currently has a row for — "which
 * domains exist" is data (see that package's `src/migrations/0001_init.ts`), not a hardcoded list
 * this file has to keep in sync with which domain packages happen to exist. A domain gets its own
 * package (`research-fusion`, `research-quantum`) only once it earns bespoke tooling beyond what's
 * here; see `docs/adr/0015-quant-fusion-ui-read-api.md` and
 * `@quant-fusion/research-store`'s `scripts/createResearchDomain.ts`. */
export function createResearchRouter(rootDir: string): Router {
  const router = createRouter();

  router.get('/', (_req: Request, res: Response) => {
    listResearchDomains()
      .then((domains) => {
        res.json({ domains });
      })
      .catch((error: unknown) => {
        res.status(500).json({ error: errorMessage(error) });
      });
  });

  router.get('/:domain', (req: Request, res: Response) => {
    const { domain } = req.params;
    if (domain === undefined) {
      res.status(400).json({ error: 'domain is required.' });
      return;
    }
    loadResearchDataset(domain)
      .then((result) => {
        if (!result.ok) {
          res.status(404).json({ error: result.error });
          return;
        }
        res.json({ dataset: result.dataset });
      })
      .catch((error: unknown) => {
        res.status(500).json({ error: errorMessage(error) });
      });
  });

  router.get('/:domain/tickers', (req: Request, res: Response) => {
    const { domain } = req.params;
    if (domain === undefined) {
      res.status(400).json({ error: 'domain is required.' });
      return;
    }
    listTrackedTickers(domain)
      .then((result) => {
        if (!result.ok) {
          res.status(404).json({ error: result.error });
          return;
        }
        res.json({ tickers: result.tickers });
      })
      .catch((error: unknown) => {
        res.status(500).json({ error: errorMessage(error) });
      });
  });

  router.get('/:domain/event-types', (req: Request, res: Response) => {
    const { domain } = req.params;
    if (domain === undefined) {
      res.status(400).json({ error: 'domain is required.' });
      return;
    }
    listEventTypes(domain)
      .then((result) => {
        if (!result.ok) {
          res.status(404).json({ error: result.error });
          return;
        }
        res.json({ eventTypes: result.eventTypes });
      })
      .catch((error: unknown) => {
        res.status(500).json({ error: errorMessage(error) });
      });
  });

  router.get('/:domain/entity-types', (req: Request, res: Response) => {
    const { domain } = req.params;
    if (domain === undefined) {
      res.status(400).json({ error: 'domain is required.' });
      return;
    }
    listEntityTypes(domain)
      .then((result) => {
        if (!result.ok) {
          res.status(404).json({ error: result.error });
          return;
        }
        res.json({ entityTypes: result.entityTypes });
      })
      .catch((error: unknown) => {
        res.status(500).json({ error: errorMessage(error) });
      });
  });

  router.get('/:domain/relationship-types', (req: Request, res: Response) => {
    const { domain } = req.params;
    if (domain === undefined) {
      res.status(400).json({ error: 'domain is required.' });
      return;
    }
    listRelationshipTypes(domain)
      .then((result) => {
        if (!result.ok) {
          res.status(404).json({ error: result.error });
          return;
        }
        res.json({ relationshipTypes: result.relationshipTypes });
      })
      .catch((error: unknown) => {
        res.status(500).json({ error: errorMessage(error) });
      });
  });

  // Quant analysis reads — thin wrappers over `@quant-fusion/quant-sdk-js`'s own pure functions
  // (see `../lib/quantAnalysis.ts`'s own doc comment for why these are a direct import, not a
  // subprocess call like the mutating research-store actions below).

  router.get('/:domain/exposure/:entityId', (req: Request, res: Response) => {
    const { domain, entityId } = req.params;
    if (domain === undefined || entityId === undefined) {
      res.status(400).json({ error: 'domain and entityId are required.' });
      return;
    }
    const asOf = typeof req.query.asOf === 'string' ? req.query.asOf : undefined;
    getExposureMap(domain, entityId, asOf)
      .then((result) => {
        if (!result.ok) {
          res.status(404).json({ error: result.error });
          return;
        }
        res.json({ exposure: result.exposure });
      })
      .catch((error: unknown) => {
        res.status(500).json({ error: errorMessage(error) });
      });
  });

  router.get('/:domain/delta', (req: Request, res: Response) => {
    const { domain } = req.params;
    if (domain === undefined) {
      res.status(400).json({ error: 'domain is required.' });
      return;
    }
    const { targetEntityId, from, to } = req.query;
    if (typeof targetEntityId !== 'string' || typeof from !== 'string' || typeof to !== 'string') {
      res
        .status(400)
        .json({ error: 'Query params "targetEntityId", "from", and "to" are all required.' });
      return;
    }
    getResearchDelta(domain, targetEntityId, from, to)
      .then((result) => {
        if (!result.ok) {
          res.status(404).json({ error: result.error });
          return;
        }
        res.json({ delta: result.delta, effects: result.effects });
      })
      .catch((error: unknown) => {
        res.status(500).json({ error: errorMessage(error) });
      });
  });

  router.get('/:domain/thesis-groups', (req: Request, res: Response) => {
    const { domain } = req.params;
    if (domain === undefined) {
      res.status(400).json({ error: 'domain is required.' });
      return;
    }
    const minSharedIds =
      typeof req.query.minSharedIds === 'string' ? Number(req.query.minSharedIds) : undefined;
    if (minSharedIds !== undefined && (!Number.isFinite(minSharedIds) || minSharedIds < 1)) {
      res.status(400).json({ error: '"minSharedIds", when given, must be a positive number.' });
      return;
    }
    const asOf = typeof req.query.asOf === 'string' ? req.query.asOf : undefined;
    getThesisGroups(domain, minSharedIds, asOf)
      .then((result) => {
        if (!result.ok) {
          res.status(404).json({ error: result.error });
          return;
        }
        res.json(result.value);
      })
      .catch((error: unknown) => {
        res.status(500).json({ error: errorMessage(error) });
      });
  });

  // Phase B — mutating actions (see docs/adr/0015's Phase B note).

  router.post('/domains', (req: Request, res: Response) => {
    const body: unknown = req.body;
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      res.status(400).json({ error: 'Request body must be a JSON object.' });
      return;
    }
    const { name, domain, priority } = body as Record<string, unknown>;
    if (typeof name !== 'string' || name.trim() === '') {
      res.status(400).json({ error: 'Request body must include a non-empty "name" string.' });
      return;
    }
    if (domain !== undefined && typeof domain !== 'string') {
      res.status(400).json({ error: '"domain", when given, must be a string.' });
      return;
    }
    if (priority !== undefined && typeof priority !== 'number') {
      res.status(400).json({ error: '"priority", when given, must be a number.' });
      return;
    }
    const lockKey = 'research:create-domain';
    if (isLocked(lockKey)) {
      res.status(409).json({ error: 'A domain is already being created — try again shortly.' });
      return;
    }
    withLock(lockKey, () => createResearchDomain(name, domain, priority))
      .then((result) => {
        res.json(result);
      })
      .catch((error: unknown) => {
        res.status(500).json({ error: errorMessage(error) });
      });
  });

  router.post('/:domain/apply-update', (req: Request, res: Response) => {
    const { domain } = req.params;
    if (domain === undefined) {
      res.status(400).json({ error: 'domain is required.' });
      return;
    }
    const update: unknown = req.body;
    if (typeof update !== 'object' || update === null || Array.isArray(update)) {
      res
        .status(400)
        .json({ error: 'Request body must be a JSON object (a partial ResearchDataset).' });
      return;
    }
    const lockKey = `research:apply-update:${domain}`;
    if (isLocked(lockKey)) {
      res.status(409).json({ error: 'Another research update is already being applied.' });
      return;
    }
    withLock(lockKey, () => applyResearchUpdate(domain, update))
      .then((result) => {
        res.json(result);
      })
      .catch((error: unknown) => {
        res.status(500).json({ error: errorMessage(error) });
      });
  });

  router.post('/:domain/news-agent/run', (req: Request, res: Response) => {
    const { domain } = req.params;
    if (domain === undefined) {
      res.status(400).json({ error: 'domain is required.' });
      return;
    }
    const body: unknown = req.body;
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      res.status(400).json({ error: 'Request body must be a JSON object.' });
      return;
    }
    const { model, provider } = body as Record<string, unknown>;
    if (typeof model !== 'string' || model.trim() === '') {
      res.status(400).json({ error: 'Request body must include a non-empty "model" string.' });
      return;
    }
    if (provider !== undefined && provider !== 'ollama' && provider !== 'openai') {
      res.status(400).json({ error: '"provider" must be "ollama" or "openai" when given.' });
      return;
    }
    const resolvedProvider: LlmProvider = provider ?? 'ollama';
    const lockKey = `research:news-agent:${domain}`;
    if (isLocked(lockKey)) {
      res.status(409).json({ error: 'A news agent run is already in progress for this domain.' });
      return;
    }
    withLock(lockKey, () => runNewsAgent(rootDir, domain, resolvedProvider, model))
      .then((result) => {
        res.json(result);
      })
      .catch((error: unknown) => {
        res.status(500).json({ error: errorMessage(error) });
      });
  });

  router.post('/:domain/tickers', (req: Request, res: Response) => {
    const { domain } = req.params;
    if (domain === undefined) {
      res.status(400).json({ error: 'domain is required.' });
      return;
    }
    const body: unknown = req.body;
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      res.status(400).json({ error: 'Request body must be a JSON object.' });
      return;
    }
    const { ticker, companyName } = body as Record<string, unknown>;
    if (typeof ticker !== 'string' || ticker.trim() === '') {
      res.status(400).json({ error: 'Request body must include a non-empty "ticker" string.' });
      return;
    }
    if (typeof companyName !== 'string' || companyName.trim() === '') {
      res
        .status(400)
        .json({ error: 'Request body must include a non-empty "companyName" string.' });
      return;
    }
    const lockKey = `research:tickers:${domain}`;
    if (isLocked(lockKey)) {
      res.status(409).json({ error: 'Another ticker change is already in progress.' });
      return;
    }
    withLock(lockKey, () => addTrackedTicker(domain, ticker, companyName))
      .then((result) => {
        res.json(result);
      })
      .catch((error: unknown) => {
        res.status(500).json({ error: errorMessage(error) });
      });
  });

  router.delete('/:domain/tickers/:ticker', (req: Request, res: Response) => {
    const { domain, ticker } = req.params;
    if (domain === undefined || ticker === undefined) {
      res.status(400).json({ error: 'domain and ticker are required.' });
      return;
    }
    const lockKey = `research:tickers:${domain}`;
    if (isLocked(lockKey)) {
      res.status(409).json({ error: 'Another ticker change is already in progress.' });
      return;
    }
    withLock(lockKey, () => removeTrackedTicker(domain, ticker))
      .then((result) => {
        res.json(result);
      })
      .catch((error: unknown) => {
        res.status(500).json({ error: errorMessage(error) });
      });
  });

  router.post('/:domain/event-types', (req: Request, res: Response) => {
    const { domain } = req.params;
    if (domain === undefined) {
      res.status(400).json({ error: 'domain is required.' });
      return;
    }
    const body: unknown = req.body;
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      res.status(400).json({ error: 'Request body must be a JSON object.' });
      return;
    }
    const { type } = body as Record<string, unknown>;
    if (typeof type !== 'string' || type.trim() === '') {
      res.status(400).json({ error: 'Request body must include a non-empty "type" string.' });
      return;
    }
    const lockKey = `research:event-types:${domain}`;
    if (isLocked(lockKey)) {
      res.status(409).json({ error: 'Another event type change is already in progress.' });
      return;
    }
    withLock(lockKey, () => addEventType(domain, type))
      .then((result) => {
        res.json(result);
      })
      .catch((error: unknown) => {
        res.status(500).json({ error: errorMessage(error) });
      });
  });

  router.patch('/:domain/event-types/:type', (req: Request, res: Response) => {
    const { domain, type } = req.params;
    if (domain === undefined || type === undefined) {
      res.status(400).json({ error: 'domain and type are required.' });
      return;
    }
    const body: unknown = req.body;
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      res.status(400).json({ error: 'Request body must be a JSON object.' });
      return;
    }
    const { newType } = body as Record<string, unknown>;
    if (typeof newType !== 'string' || newType.trim() === '') {
      res.status(400).json({ error: 'Request body must include a non-empty "newType" string.' });
      return;
    }
    const lockKey = `research:event-types:${domain}`;
    if (isLocked(lockKey)) {
      res.status(409).json({ error: 'Another event type change is already in progress.' });
      return;
    }
    withLock(lockKey, () => renameEventType(domain, type, newType))
      .then((result) => {
        res.json(result);
      })
      .catch((error: unknown) => {
        res.status(500).json({ error: errorMessage(error) });
      });
  });

  // Registered BEFORE the generic collection route below, same reason as the tickers delete
  // route above — `:collection` there would otherwise capture the literal "event-types" segment
  // too.
  router.delete('/:domain/event-types/:type', (req: Request, res: Response) => {
    const { domain, type } = req.params;
    if (domain === undefined || type === undefined) {
      res.status(400).json({ error: 'domain and type are required.' });
      return;
    }
    const lockKey = `research:event-types:${domain}`;
    if (isLocked(lockKey)) {
      res.status(409).json({ error: 'Another event type change is already in progress.' });
      return;
    }
    withLock(lockKey, () => deleteEventType(domain, type))
      .then((result) => {
        res.json(result);
      })
      .catch((error: unknown) => {
        res.status(500).json({ error: errorMessage(error) });
      });
  });

  router.post('/:domain/entity-types', (req: Request, res: Response) => {
    const { domain } = req.params;
    if (domain === undefined) {
      res.status(400).json({ error: 'domain is required.' });
      return;
    }
    const body: unknown = req.body;
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      res.status(400).json({ error: 'Request body must be a JSON object.' });
      return;
    }
    const { type } = body as Record<string, unknown>;
    if (typeof type !== 'string' || type.trim() === '') {
      res.status(400).json({ error: 'Request body must include a non-empty "type" string.' });
      return;
    }
    const lockKey = `research:entity-types:${domain}`;
    if (isLocked(lockKey)) {
      res.status(409).json({ error: 'Another entity type change is already in progress.' });
      return;
    }
    withLock(lockKey, () => addEntityType(domain, type))
      .then((result) => {
        res.json(result);
      })
      .catch((error: unknown) => {
        res.status(500).json({ error: errorMessage(error) });
      });
  });

  router.patch('/:domain/entity-types/:type', (req: Request, res: Response) => {
    const { domain, type } = req.params;
    if (domain === undefined || type === undefined) {
      res.status(400).json({ error: 'domain and type are required.' });
      return;
    }
    const body: unknown = req.body;
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      res.status(400).json({ error: 'Request body must be a JSON object.' });
      return;
    }
    const { newType } = body as Record<string, unknown>;
    if (typeof newType !== 'string' || newType.trim() === '') {
      res.status(400).json({ error: 'Request body must include a non-empty "newType" string.' });
      return;
    }
    const lockKey = `research:entity-types:${domain}`;
    if (isLocked(lockKey)) {
      res.status(409).json({ error: 'Another entity type change is already in progress.' });
      return;
    }
    withLock(lockKey, () => renameEntityType(domain, type, newType))
      .then((result) => {
        res.json(result);
      })
      .catch((error: unknown) => {
        res.status(500).json({ error: errorMessage(error) });
      });
  });

  // Registered BEFORE the generic collection route below, same reason as the tickers/event-types
  // delete routes above — `:collection` there would otherwise capture the literal "entity-types"
  // segment too.
  router.delete('/:domain/entity-types/:type', (req: Request, res: Response) => {
    const { domain, type } = req.params;
    if (domain === undefined || type === undefined) {
      res.status(400).json({ error: 'domain and type are required.' });
      return;
    }
    const lockKey = `research:entity-types:${domain}`;
    if (isLocked(lockKey)) {
      res.status(409).json({ error: 'Another entity type change is already in progress.' });
      return;
    }
    withLock(lockKey, () => deleteEntityType(domain, type))
      .then((result) => {
        res.json(result);
      })
      .catch((error: unknown) => {
        res.status(500).json({ error: errorMessage(error) });
      });
  });

  router.post('/:domain/relationship-types', (req: Request, res: Response) => {
    const { domain } = req.params;
    if (domain === undefined) {
      res.status(400).json({ error: 'domain is required.' });
      return;
    }
    const body: unknown = req.body;
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      res.status(400).json({ error: 'Request body must be a JSON object.' });
      return;
    }
    const { type } = body as Record<string, unknown>;
    if (typeof type !== 'string' || type.trim() === '') {
      res.status(400).json({ error: 'Request body must include a non-empty "type" string.' });
      return;
    }
    const lockKey = `research:relationship-types:${domain}`;
    if (isLocked(lockKey)) {
      res.status(409).json({ error: 'Another relationship type change is already in progress.' });
      return;
    }
    withLock(lockKey, () => addRelationshipType(domain, type))
      .then((result) => {
        res.json(result);
      })
      .catch((error: unknown) => {
        res.status(500).json({ error: errorMessage(error) });
      });
  });

  router.patch('/:domain/relationship-types/:type', (req: Request, res: Response) => {
    const { domain, type } = req.params;
    if (domain === undefined || type === undefined) {
      res.status(400).json({ error: 'domain and type are required.' });
      return;
    }
    const body: unknown = req.body;
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      res.status(400).json({ error: 'Request body must be a JSON object.' });
      return;
    }
    const { newType } = body as Record<string, unknown>;
    if (typeof newType !== 'string' || newType.trim() === '') {
      res.status(400).json({ error: 'Request body must include a non-empty "newType" string.' });
      return;
    }
    const lockKey = `research:relationship-types:${domain}`;
    if (isLocked(lockKey)) {
      res.status(409).json({ error: 'Another relationship type change is already in progress.' });
      return;
    }
    withLock(lockKey, () => renameRelationshipType(domain, type, newType))
      .then((result) => {
        res.json(result);
      })
      .catch((error: unknown) => {
        res.status(500).json({ error: errorMessage(error) });
      });
  });

  // `category` must be one of `RELATIONSHIP_TYPE_CATEGORIES` (or `null` to un-sort) — a person
  // sorts a relationship type into one of the Quant tab's own pre-existing Exposure Map
  // categories, never an arbitrary label. See `researchStore.ts`'s own doc comment on that const
  // for why the enum lives there instead of here or in `quantAnalysis.ts`.
  router.patch('/:domain/relationship-types/:type/category', (req: Request, res: Response) => {
    const { domain, type } = req.params;
    if (domain === undefined || type === undefined) {
      res.status(400).json({ error: 'domain and type are required.' });
      return;
    }
    const body: unknown = req.body;
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      res.status(400).json({ error: 'Request body must be a JSON object.' });
      return;
    }
    const { category } = body as Record<string, unknown>;
    if (
      category !== null &&
      (typeof category !== 'string' || !isRelationshipTypeCategory(category))
    ) {
      res.status(400).json({
        error: `Request body must include "category" as one of ${RELATIONSHIP_TYPE_CATEGORIES.join(', ')}, or null.`,
      });
      return;
    }
    const lockKey = `research:relationship-types:${domain}`;
    if (isLocked(lockKey)) {
      res.status(409).json({ error: 'Another relationship type change is already in progress.' });
      return;
    }
    withLock(lockKey, () => setRelationshipTypeCategory(domain, type, category))
      .then((result) => {
        res.json(result);
      })
      .catch((error: unknown) => {
        res.status(500).json({ error: errorMessage(error) });
      });
  });

  // Registered BEFORE the generic collection route below, same reason as the tickers/event-types/
  // entity-types delete routes above — `:collection` there would otherwise capture the literal
  // "relationship-types" segment too.
  router.delete('/:domain/relationship-types/:type', (req: Request, res: Response) => {
    const { domain, type } = req.params;
    if (domain === undefined || type === undefined) {
      res.status(400).json({ error: 'domain and type are required.' });
      return;
    }
    const lockKey = `research:relationship-types:${domain}`;
    if (isLocked(lockKey)) {
      res.status(409).json({ error: 'Another relationship type change is already in progress.' });
      return;
    }
    withLock(lockKey, () => deleteRelationshipType(domain, type))
      .then((result) => {
        res.json(result);
      })
      .catch((error: unknown) => {
        res.status(500).json({ error: errorMessage(error) });
      });
  });

  // Registered AFTER the tickers/event-types/entity-types/relationship-types literal routes
  // above — Express tries routes in registration order, and `:collection` here would otherwise
  // happily capture those literal segments too, shadowing those routes for every delete request.
  router.delete('/:domain/:collection/:id', (req: Request, res: Response) => {
    const { domain, collection, id } = req.params;
    if (domain === undefined || collection === undefined || id === undefined) {
      res.status(400).json({ error: 'domain, collection, and id are required.' });
      return;
    }
    if (
      collection !== 'entities' &&
      collection !== 'relationships' &&
      collection !== 'hypotheses'
    ) {
      res.status(400).json({
        error: '"collection" must be one of entities, relationships, hypotheses.',
      });
      return;
    }
    const lockKey = `research:apply-update:${domain}`;
    if (isLocked(lockKey)) {
      res.status(409).json({ error: 'Another research update is already being applied.' });
      return;
    }
    withLock(lockKey, () => deleteResearchItem(domain, collection, id))
      .then((result) => {
        res.json(result);
      })
      .catch((error: unknown) => {
        res.status(500).json({ error: errorMessage(error) });
      });
  });

  return router;
}
