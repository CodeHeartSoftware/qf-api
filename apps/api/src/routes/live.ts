import { randomUUID } from 'node:crypto';
import type { Request, Response, Router } from 'express';
import { Router as createRouter } from 'express';
import { resolveMarketUniverse } from '../lib/customUniverses.js';
import { runAsLiveJob } from '../lib/jobRunner.js';
import { ALLOW_LIVE_TRADING_ENV, isPaperAccountId } from '../lib/live/brokers/ibkrClientPortal.js';
import { initSimAccount } from '../lib/live/brokers/simBroker.js';
import {
  defaultLiveStoreDbPath,
  deletePortfolio,
  getPortfolio,
  listPortfolios,
  listTickets,
  savePortfolio,
} from '../lib/live/liveStore.js';
import {
  approveTicket,
  createBroker,
  proposeTicket,
  refreshTicket,
  rejectTicket,
} from '../lib/live/liveService.js';
import {
  DEFAULT_RISK_LIMITS,
  type BrokerKind,
  type ContractMapping,
  type LivePortfolio,
  type RiskLimits,
} from '../lib/live/types.js';
import { listBots } from './bots.js';
import { isLocked, withLock } from '../lib/subprocess.js';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseRisk(value: unknown, base: RiskLimits): RiskLimits | string {
  if (value === undefined) return base;
  if (typeof value !== 'object' || value === null) return '"risk" must be an object.';
  const r = value as Record<string, unknown>;
  const next: RiskLimits = { ...base };
  for (const key of [
    'maxOrderNotionalUsd',
    'maxDailyTurnoverPct',
    'maxPositionWeightPct',
  ] as const) {
    if (r[key] === undefined) continue;
    if (typeof r[key] !== 'number' || !(r[key] > 0))
      return `"risk.${key}" must be a positive number.`;
    next[key] = r[key];
  }
  if (r.maxCapitalUsd === null) delete next.maxCapitalUsd;
  else if (r.maxCapitalUsd !== undefined) {
    if (typeof r.maxCapitalUsd !== 'number' || !(r.maxCapitalUsd > 0)) {
      return '"risk.maxCapitalUsd" must be a positive number or null.';
    }
    next.maxCapitalUsd = r.maxCapitalUsd;
  }
  return next;
}

function parseContracts(value: unknown): ContractMapping[] | string {
  if (!Array.isArray(value)) return '"contracts" must be an array.';
  const contracts: ContractMapping[] = [];
  for (const raw of value as unknown[]) {
    const c = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
    if (
      typeof c.ticker !== 'string' ||
      typeof c.conid !== 'number' ||
      !Number.isInteger(c.conid) ||
      typeof c.currency !== 'string' ||
      typeof c.lotSize !== 'number' ||
      !Number.isInteger(c.lotSize) ||
      c.lotSize < 1
    ) {
      return 'Each contract needs ticker, integer conid, currency, and integer lotSize ≥ 1.';
    }
    contracts.push({
      ticker: c.ticker,
      conid: c.conid,
      currency: c.currency,
      lotSize: c.lotSize,
      ...(typeof c.exchange === 'string' ? { exchange: c.exchange } : {}),
    });
  }
  return contracts;
}

/** Real-account (broker) portfolios managed by a bot — see `lib/live/`. Every order a bot
 * proposes lands on a ticket that a person must approve before anything reaches the broker. */
export function createLiveRouter(rootDir: string): Router {
  const router = createRouter();
  const dbPath = defaultLiveStoreDbPath(rootDir);

  const withPortfolio =
    (handler: (portfolio: LivePortfolio, req: Request, res: Response) => Promise<void>) =>
    (req: Request, res: Response) => {
      const portfolio = getPortfolio(dbPath, String(req.params.portfolioId));
      if (portfolio === undefined) {
        res.status(404).json({ error: `No live portfolio "${String(req.params.portfolioId)}".` });
        return;
      }
      handler(portfolio, req, res).catch((error: unknown) => {
        res.status(500).json({ error: errorMessage(error) });
      });
    };

  router.get('/portfolios', (_req, res) => {
    res.json({
      portfolios: listPortfolios(dbPath),
      liveTradingAllowed: process.env[ALLOW_LIVE_TRADING_ENV] === '1',
    });
  });

  router.post('/portfolios', (req: Request, res: Response) => {
    (async () => {
      const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<
        string,
        unknown
      >;
      const { name, botId, broker, accountId, gatewayUrl, universeId, simStartingCashUsd } = body;
      if (typeof name !== 'string' || name.trim() === '')
        return void res.status(400).json({ error: '"name" is required.' });
      if (broker !== 'ibkr' && broker !== 'sim')
        return void res.status(400).json({ error: '"broker" must be "ibkr" or "sim".' });
      if (typeof botId !== 'string' || !(await listBots(rootDir)).some((b) => b.id === botId)) {
        return void res.status(400).json({ error: `Unknown bot "${String(botId)}".` });
      }
      if (
        typeof universeId !== 'string' ||
        (await resolveMarketUniverse(rootDir, universeId)) === undefined
      ) {
        return void res.status(400).json({ error: `Unknown universe "${String(universeId)}".` });
      }
      if (broker === 'ibkr') {
        if (typeof accountId !== 'string' || accountId.trim() === '') {
          return void res
            .status(400)
            .json({ error: 'IBKR portfolios need an "accountId" (e.g. DU1234567).' });
        }
        if (!isPaperAccountId(accountId) && process.env[ALLOW_LIVE_TRADING_ENV] !== '1') {
          return void res.status(400).json({
            error: `"${accountId}" isn't a paper account (DU…). Real-money accounts need ${ALLOW_LIVE_TRADING_ENV}=1.`,
          });
        }
      }
      if (gatewayUrl !== undefined && typeof gatewayUrl !== 'string') {
        return void res.status(400).json({ error: '"gatewayUrl" must be a string.' });
      }
      const risk = parseRisk(body.risk, DEFAULT_RISK_LIMITS);
      if (typeof risk === 'string') return void res.status(400).json({ error: risk });

      const now = new Date().toISOString();
      const portfolio: LivePortfolio = {
        id: randomUUID().slice(0, 8),
        name: name.trim(),
        botId,
        broker: broker satisfies BrokerKind,
        ...(broker === 'ibkr' ? { accountId: (accountId as string).trim().toUpperCase() } : {}),
        ...(typeof gatewayUrl === 'string' && gatewayUrl.trim() !== ''
          ? { gatewayUrl: gatewayUrl.trim() }
          : {}),
        universeId,
        contracts: [],
        risk,
        killSwitch: false,
        createdAt: now,
        updatedAt: now,
      };
      if (broker === 'sim') {
        const cash =
          typeof simStartingCashUsd === 'number' && simStartingCashUsd > 0
            ? simStartingCashUsd
            : 100_000;
        await initSimAccount(rootDir, portfolio.id, cash);
      }
      savePortfolio(dbPath, portfolio);
      res.status(201).json({ portfolio });
    })().catch((error: unknown) => {
      res.status(500).json({ error: errorMessage(error) });
    });
  });

  router.patch(
    '/portfolios/:portfolioId',
    withPortfolio(async (portfolio, req, res) => {
      const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<
        string,
        unknown
      >;
      const next: LivePortfolio = { ...portfolio, updatedAt: new Date().toISOString() };
      if (body.name !== undefined) {
        if (typeof body.name !== 'string' || body.name.trim() === '')
          return void res.status(400).json({ error: '"name" must be non-empty.' });
        next.name = body.name.trim();
      }
      if (body.killSwitch !== undefined) {
        if (typeof body.killSwitch !== 'boolean')
          return void res.status(400).json({ error: '"killSwitch" must be a boolean.' });
        next.killSwitch = body.killSwitch;
      }
      const risk = parseRisk(body.risk, portfolio.risk);
      if (typeof risk === 'string') return void res.status(400).json({ error: risk });
      next.risk = risk;
      if (body.contracts !== undefined) {
        const contracts = parseContracts(body.contracts);
        if (typeof contracts === 'string') return void res.status(400).json({ error: contracts });
        next.contracts = contracts;
      }
      savePortfolio(dbPath, next);
      res.json({ portfolio: next });
      await Promise.resolve();
    }),
  );

  router.delete(
    '/portfolios/:portfolioId',
    withPortfolio(async (portfolio, _req, res) => {
      deletePortfolio(dbPath, portfolio.id);
      res.json({ deleted: portfolio.id });
      await Promise.resolve();
    }),
  );

  router.get(
    '/portfolios/:portfolioId/broker-status',
    withPortfolio(async (portfolio, _req, res) => {
      res.json(await createBroker(rootDir, portfolio).connectionStatus());
    }),
  );

  router.get(
    '/portfolios/:portfolioId/snapshot',
    withPortfolio(async (portfolio, _req, res) => {
      res.json({ snapshot: await createBroker(rootDir, portfolio).snapshot() });
    }),
  );

  router.get(
    '/portfolios/:portfolioId/contracts/search',
    withPortfolio(async (portfolio, req, res) => {
      const symbol = typeof req.query.symbol === 'string' ? req.query.symbol.trim() : '';
      if (symbol === '') return void res.status(400).json({ error: '"symbol" is required.' });
      res.json({ candidates: await createBroker(rootDir, portfolio).searchContracts(symbol) });
    }),
  );

  router.get(
    '/portfolios/:portfolioId/tickets',
    withPortfolio(async (portfolio, _req, res) => {
      res.json({ tickets: listTickets(dbPath, portfolio.id) });
      await Promise.resolve();
    }),
  );

  // Never touches the broker's orders — only reads the account and asks the bot.
  router.post(
    '/portfolios/:portfolioId/propose',
    withPortfolio(async (portfolio, _req, res) => {
      const lockKey = `live:${portfolio.id}`;
      if (isLocked(lockKey)) return void res.status(409).json({ error: 'This portfolio is busy.' });
      const ticket = await withLock(lockKey, () =>
        runAsLiveJob(
          rootDir,
          { kind: 'live-propose', label: `Propose orders · ${portfolio.name}` },
          async (ctx) => ({
            ok: true,
            ticket: await proposeTicket(rootDir, portfolio, { log: ctx.log }),
          }),
        ),
      );
      res.json({ ticket: ticket.ticket });
    }),
  );

  const ticketAction = (action: 'approve' | 'reject' | 'refresh') =>
    withPortfolio(async (portfolio, req, res) => {
      const ticketId = String(req.params.ticketId);
      const lockKey = `live:${portfolio.id}`;
      if (isLocked(lockKey)) return void res.status(409).json({ error: 'This portfolio is busy.' });
      const ticket = await withLock(lockKey, async () =>
        action === 'approve'
          ? approveTicket(rootDir, portfolio, ticketId)
          : action === 'reject'
            ? rejectTicket(rootDir, portfolio, ticketId)
            : refreshTicket(rootDir, portfolio, ticketId),
      ).catch((error: unknown) => {
        res.status(409).json({ error: errorMessage(error) });
        return undefined;
      });
      if (ticket !== undefined) res.json({ ticket });
    });

  router.post('/portfolios/:portfolioId/tickets/:ticketId/approve', ticketAction('approve'));
  router.post('/portfolios/:portfolioId/tickets/:ticketId/reject', ticketAction('reject'));
  router.post('/portfolios/:portfolioId/tickets/:ticketId/refresh', ticketAction('refresh'));

  return router;
}
