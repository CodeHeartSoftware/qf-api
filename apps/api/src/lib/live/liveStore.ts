// Live portfolios and their order tickets. Records are stored as JSON documents (one row each)
// with only the columns needed for lookup broken out — the shapes in `types.ts` are still
// settling, and every read/write here is whole-record anyway. Same open-per-call, migrate-on-open
// convention as `@quant-fusion/job-run-store`.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { applyMigrations, type Migration } from '@quant-fusion/sqlite-migrations';
import type { LivePortfolio, OrderTicket } from './types.js';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: typeof DatabaseSyncType;
};

const LIVE_STORE_MIGRATIONS: Migration[] = [
  {
    id: 'live-store/0001_init',
    sql: `
CREATE TABLE IF NOT EXISTS live_portfolios (
  id         TEXT NOT NULL PRIMARY KEY,
  created_at TEXT NOT NULL,
  doc        TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS live_tickets (
  id           TEXT NOT NULL PRIMARY KEY,
  portfolio_id TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  status       TEXT NOT NULL,
  doc          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_live_tickets_portfolio ON live_tickets (portfolio_id, created_at);
`,
  },
];

export function defaultLiveStoreDbPath(rootDir: string): string {
  return path.join(rootDir, '.quant-fusion', 'live.sqlite');
}

function withDb<T>(dbPath: string, fn: (db: DatabaseSyncType) => T): T {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  try {
    const migrated = applyMigrations(db, LIVE_STORE_MIGRATIONS);
    if (!migrated.ok) throw new Error(`live-store migrations failed: ${migrated.reason}`);
    return fn(db);
  } finally {
    db.close();
  }
}

export function listPortfolios(dbPath: string): LivePortfolio[] {
  return withDb(dbPath, (db) =>
    (
      db.prepare('SELECT doc FROM live_portfolios ORDER BY created_at').all() as { doc: string }[]
    ).map((row) => JSON.parse(row.doc) as LivePortfolio),
  );
}

export function getPortfolio(dbPath: string, id: string): LivePortfolio | undefined {
  return withDb(dbPath, (db) => {
    const row = db.prepare('SELECT doc FROM live_portfolios WHERE id = ?').get(id) as
      { doc: string } | undefined;
    return row === undefined ? undefined : (JSON.parse(row.doc) as LivePortfolio);
  });
}

export function savePortfolio(dbPath: string, portfolio: LivePortfolio): void {
  withDb(dbPath, (db) => {
    db.prepare(
      'INSERT INTO live_portfolios (id, created_at, doc) VALUES (?, ?, ?) ' +
        'ON CONFLICT(id) DO UPDATE SET doc = excluded.doc',
    ).run(portfolio.id, portfolio.createdAt, JSON.stringify(portfolio));
  });
}

/** Deletes the portfolio and its tickets. */
export function deletePortfolio(dbPath: string, id: string): boolean {
  return withDb(dbPath, (db) => {
    db.prepare('DELETE FROM live_tickets WHERE portfolio_id = ?').run(id);
    return Number(db.prepare('DELETE FROM live_portfolios WHERE id = ?').run(id).changes) > 0;
  });
}

export function listTickets(dbPath: string, portfolioId: string, limit = 50): OrderTicket[] {
  return withDb(dbPath, (db) =>
    (
      db
        .prepare(
          'SELECT doc FROM live_tickets WHERE portfolio_id = ? ORDER BY created_at DESC LIMIT ?',
        )
        .all(portfolioId, limit) as { doc: string }[]
    ).map((row) => JSON.parse(row.doc) as OrderTicket),
  );
}

export function getTicket(dbPath: string, id: string): OrderTicket | undefined {
  return withDb(dbPath, (db) => {
    const row = db.prepare('SELECT doc FROM live_tickets WHERE id = ?').get(id) as
      { doc: string } | undefined;
    return row === undefined ? undefined : (JSON.parse(row.doc) as OrderTicket);
  });
}

export function saveTicket(dbPath: string, ticket: OrderTicket): void {
  withDb(dbPath, (db) => {
    db.prepare(
      'INSERT INTO live_tickets (id, portfolio_id, created_at, status, doc) VALUES (?, ?, ?, ?, ?) ' +
        'ON CONFLICT(id) DO UPDATE SET status = excluded.status, doc = excluded.doc',
    ).run(ticket.id, ticket.portfolioId, ticket.createdAt, ticket.status, JSON.stringify(ticket));
  });
}
