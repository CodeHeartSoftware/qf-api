import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  BrokerAccountSnapshot,
  BrokerAdapter,
  BrokerOrderRequest,
  BrokerOrderStatus,
  BrokerPosition,
} from '../types.js';

interface SimAccountState {
  cashUsd: number;
  positions: Record<string, { shares: number; averageCostUsd: number }>;
  orders: BrokerOrderStatus[];
}

/** Flat per-order commission, roughly an IBKR fixed-tier minimum. */
const COMMISSION_USD = 1;

export function simAccountPath(rootDir: string, portfolioId: string): string {
  return path.join(rootDir, '.quant-fusion', 'live', 'sim', `${portfolioId}.json`);
}

/** Creates the simulated account file with `startingCashUsd` (refuses to overwrite one). */
export async function initSimAccount(
  rootDir: string,
  portfolioId: string,
  startingCashUsd: number,
): Promise<void> {
  const file = simAccountPath(rootDir, portfolioId);
  await mkdir(path.dirname(file), { recursive: true });
  const state: SimAccountState = { cashUsd: startingCashUsd, positions: {}, orders: [] };
  await writeFile(file, JSON.stringify(state, null, 2), { encoding: 'utf8', flag: 'wx' });
}

/**
 * A local paper account with no broker behind it: MARKET orders fill instantly, in full, at the
 * order's reference price (the bot's own latest close) plus a $1 commission; LIMIT orders fill only
 * if that reference price is at or through the limit, else they're cancelled. Deliberately crude —
 * it exists to exercise the Live tab's propose → approve → submit → reconcile workflow end to end,
 * NOT to measure performance (that's what forward matches, with realistic execution, are for).
 */
export function createSimAdapter(rootDir: string, portfolioId: string): BrokerAdapter {
  const file = simAccountPath(rootDir, portfolioId);

  async function load(): Promise<SimAccountState> {
    try {
      return JSON.parse(await readFile(file, 'utf8')) as SimAccountState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Simulated account for "${portfolioId}" doesn't exist.`);
      }
      throw error;
    }
  }

  async function save(state: SimAccountState): Promise<void> {
    await writeFile(file, JSON.stringify(state, null, 2), 'utf8');
  }

  return {
    kind: 'sim',

    connectionStatus() {
      return Promise.resolve({ connected: true, authenticated: true });
    },

    async snapshot(): Promise<BrokerAccountSnapshot> {
      const state = await load();
      const positions: BrokerPosition[] = Object.entries(state.positions)
        .filter(([, p]) => p.shares !== 0)
        .map(([ticker, p]) => ({
          ticker,
          description: ticker,
          shares: p.shares,
          averageCost: p.averageCostUsd,
          currency: 'USD',
        }));
      const positionsAtCost = positions.reduce((sum, p) => sum + p.shares * p.averageCost, 0);
      return {
        accountId: `SIM-${portfolioId}`,
        asOf: new Date().toISOString(),
        cashUsd: state.cashUsd,
        // At cost — the sim has no live quotes; the ticket's bot equity uses real closes instead.
        netLiquidationUsd: state.cashUsd + positionsAtCost,
        positions,
      };
    },

    async placeOrders(orders: BrokerOrderRequest[]): Promise<BrokerOrderStatus[]> {
      const state = await load();
      const statuses = orders.map((order): BrokerOrderStatus => {
        const price = order.referencePrice;
        const crosses =
          order.orderType === 'MKT' ||
          (order.limitPrice !== undefined &&
            (order.side === 'BUY' ? price <= order.limitPrice : price >= order.limitPrice));
        const position = state.positions[order.ticker] ?? { shares: 0, averageCostUsd: 0 };
        const cost = order.quantity * price;
        let reason: string | undefined;
        if (!crosses)
          reason = `Limit ${String(order.limitPrice)} not reached at ${price.toFixed(2)} — cancelled.`;
        else if (order.side === 'BUY' && cost + COMMISSION_USD > state.cashUsd)
          reason = 'Insufficient cash.';
        else if (order.side === 'SELL' && order.quantity > position.shares)
          reason = 'Insufficient shares.';
        if (reason !== undefined) {
          return {
            clientOrderId: order.clientOrderId,
            state: crosses ? 'rejected' : 'cancelled',
            filledQuantity: 0,
            messages: [reason],
          };
        }
        if (order.side === 'BUY') {
          const shares = position.shares + order.quantity;
          state.positions[order.ticker] = {
            shares,
            averageCostUsd: (position.shares * position.averageCostUsd + cost) / shares,
          };
          state.cashUsd -= cost + COMMISSION_USD;
        } else {
          state.positions[order.ticker] = { ...position, shares: position.shares - order.quantity };
          state.cashUsd += cost - COMMISSION_USD;
        }
        return {
          clientOrderId: order.clientOrderId,
          brokerOrderId: `sim-${order.clientOrderId}`,
          state: 'filled',
          filledQuantity: order.quantity,
          averageFillPrice: price,
          messages: [`Simulated fill + $${String(COMMISSION_USD)} commission.`],
        };
      });
      state.orders.push(...statuses);
      await save(state);
      return statuses;
    },

    async orderStatuses(clientOrderIds: string[]): Promise<BrokerOrderStatus[]> {
      const state = await load();
      return state.orders.filter((o) => clientOrderIds.includes(o.clientOrderId));
    },

    searchContracts() {
      return Promise.resolve([]);
    },
  };
}
