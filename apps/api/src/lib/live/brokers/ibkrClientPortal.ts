import http from 'node:http';
import https from 'node:https';
import type {
  BrokerAccountSnapshot,
  BrokerAdapter,
  BrokerConnectionStatus,
  BrokerOrderRequest,
  BrokerOrderState,
  BrokerOrderStatus,
  BrokerPosition,
  ContractCandidate,
  ContractMapping,
} from '../types.js';

export const DEFAULT_IBKR_GATEWAY_URL = 'https://localhost:5000';

/** IBKR paper accounts are `DU…`; live ones `U…`. Real-money accounts are refused unless the API
 * runs with this env var set — a deliberate, out-of-band switch rather than a UI checkbox. */
export const ALLOW_LIVE_TRADING_ENV = 'QUANT_FUSION_ALLOW_LIVE_TRADING';

export function isPaperAccountId(accountId: string): boolean {
  return /^DU/i.test(accountId);
}

export type HttpTransport = (
  method: 'GET' | 'POST',
  url: string,
  body?: unknown,
) => Promise<{ status: number; json: unknown }>;

/** The Client Portal Gateway runs on localhost with a self-signed certificate — accepted ONLY for
 * a loopback host, never for anything remote. */
export const nodeHttpTransport: HttpTransport = (method, url, body) =>
  new Promise((resolve, reject) => {
    const target = new URL(url);
    const loopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(target.hostname);
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const client = target.protocol === 'https:' ? https : http;
    const request = client.request(
      target,
      {
        method,
        headers: {
          'User-Agent': 'quant-fusion-sm4',
          ...(payload !== undefined
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
            : {}),
        },
        ...(target.protocol === 'https:' && loopback ? { rejectUnauthorized: false } : {}),
        timeout: 15_000,
      },
      (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          text += chunk;
        });
        response.on('end', () => {
          let json: unknown = text;
          try {
            json = text === '' ? null : (JSON.parse(text) as unknown);
          } catch {
            // Leave as raw text — surfaced in the error below.
          }
          resolve({ status: response.statusCode ?? 0, json });
        });
      },
    );
    request.on('timeout', () => {
      request.destroy(new Error(`IBKR gateway request timed out: ${method} ${target.pathname}`));
    });
    request.on('error', reject);
    if (payload !== undefined) request.write(payload);
    request.end();
  });

type Json = Record<string, unknown>;

function asRecord(value: unknown): Json {
  return typeof value === 'object' && value !== null ? (value as Json) : {};
}

function num(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)))
    return Number(value);
  return undefined;
}

/** IBKR order statuses → ours. `PreSubmitted` (held until the session opens) counts as submitted. */
export function mapIbkrOrderState(
  status: string,
  filled: number,
  total: number | undefined,
): BrokerOrderState {
  switch (status.toLowerCase()) {
    case 'filled':
      return 'filled';
    case 'cancelled':
    case 'apicancelled':
    case 'pendingcancel':
      return 'cancelled';
    case 'inactive':
    case 'rejected':
      return 'rejected';
    case 'pendingsubmit':
    case 'apipending':
      return 'pending';
    default:
      return filled > 0 && (total === undefined || filled < total)
        ? 'partially_filled'
        : 'submitted';
  }
}

export interface IbkrAdapterOptions {
  accountId: string;
  gatewayUrl?: string;
  contracts: readonly ContractMapping[];
  transport?: HttpTransport;
  allowLiveTrading?: boolean;
}

/**
 * Interactive Brokers through the Client Portal Gateway (IBKR's local REST gateway: download it,
 * run it, log in once in a browser with your PAPER credentials — sessions expire roughly daily and
 * need a fresh browser login). Every call goes to that local gateway; nothing here ever holds
 * IBKR credentials itself.
 *
 * Order submission auto-confirms IBKR's precautionary "are you sure?" replies (the person already
 * approved the ticket in this app) but records every message on the order's status, so nothing
 * IBKR said is ever hidden.
 */
export function createIbkrAdapter(options: IbkrAdapterOptions): BrokerAdapter {
  const base = `${(options.gatewayUrl ?? DEFAULT_IBKR_GATEWAY_URL).replace(/\/$/, '')}/v1/api`;
  const transport = options.transport ?? nodeHttpTransport;
  const { accountId } = options;
  const tickerByConid = new Map(options.contracts.map((c) => [c.conid, c.ticker]));

  async function call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    const { status, json } = await transport(method, `${base}${path}`, body);
    if (status === 401) {
      throw new Error(
        'IBKR gateway session is not authenticated — log in at the gateway URL in a browser.',
      );
    }
    if (status < 200 || status >= 300) {
      const message = asRecord(json).error ?? json;
      throw new Error(
        `IBKR ${method} ${path} failed (${String(status)}): ${typeof message === 'string' ? message : JSON.stringify(message)}`,
      );
    }
    return json;
  }

  function assertTradable(): void {
    if (!isPaperAccountId(accountId) && options.allowLiveTrading !== true) {
      throw new Error(
        `Account ${accountId} is not an IBKR paper account (DU…). Real-money trading is disabled ` +
          `unless the API is started with ${ALLOW_LIVE_TRADING_ENV}=1.`,
      );
    }
  }

  function toStatus(clientOrderId: string, raw: Json, messages: string[]): BrokerOrderStatus {
    const filled = num(raw.filledQuantity) ?? 0;
    const total = num(raw.totalSize);
    const status =
      typeof raw.status === 'string'
        ? raw.status
        : typeof raw.order_status === 'string'
          ? raw.order_status
          : 'Submitted';
    const avg = num(raw.avgPrice);
    const orderId = num(raw.orderId ?? raw.order_id);
    return {
      clientOrderId,
      ...(orderId !== undefined ? { brokerOrderId: String(orderId) } : {}),
      state: mapIbkrOrderState(status, filled, total),
      filledQuantity: filled,
      ...(avg !== undefined ? { averageFillPrice: avg } : {}),
      messages,
    };
  }

  return {
    kind: 'ibkr',

    async connectionStatus(): Promise<BrokerConnectionStatus> {
      try {
        const status = asRecord(await call('POST', '/iserver/auth/status'));
        const authenticated = status.authenticated === true;
        const connected = status.connected === true;
        return {
          connected,
          authenticated,
          ...(!authenticated
            ? { message: 'Gateway reachable but not logged in — log in at the gateway URL.' }
            : {}),
        };
      } catch (error) {
        return {
          connected: false,
          authenticated: false,
          message: `Can't reach the IBKR Client Portal Gateway: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },

    async snapshot(): Promise<BrokerAccountSnapshot> {
      // IBKR requires /portfolio/accounts before any other /portfolio endpoint in a session.
      await call('GET', '/portfolio/accounts');
      const ledger = asRecord(await call('GET', `/portfolio/${accountId}/ledger`));
      const baseLedger = asRecord(ledger.BASE);
      const baseCurrency = typeof baseLedger.currency === 'string' ? baseLedger.currency : 'BASE';
      if (baseCurrency !== 'USD' && baseCurrency !== 'BASE') {
        throw new Error(
          `Account ${accountId}'s base currency is ${baseCurrency}; only USD-based accounts are supported.`,
        );
      }
      const rawPositions = await call('GET', `/portfolio/${accountId}/positions/0`);
      const positions: BrokerPosition[] = (Array.isArray(rawPositions) ? rawPositions : []).map(
        (p) => {
          const raw = asRecord(p);
          const conid = num(raw.conid);
          const ticker = conid !== undefined ? tickerByConid.get(conid) : undefined;
          const currency = typeof raw.currency === 'string' ? raw.currency : 'USD';
          const marketValue = num(raw.mktValue);
          return {
            ...(ticker !== undefined ? { ticker } : {}),
            ...(conid !== undefined ? { conid } : {}),
            description:
              typeof raw.contractDesc === 'string' ? raw.contractDesc : String(conid ?? '?'),
            shares: num(raw.position) ?? 0,
            averageCost: num(raw.avgCost) ?? 0,
            currency,
            ...(marketValue !== undefined && currency === 'USD'
              ? { marketValueUsd: marketValue }
              : {}),
          };
        },
      );
      return {
        accountId,
        asOf: new Date().toISOString(),
        cashUsd: num(baseLedger.cashbalance) ?? 0,
        netLiquidationUsd: num(baseLedger.netliquidationvalue) ?? 0,
        positions: positions.filter((p) => p.shares !== 0),
      };
    },

    async placeOrders(orders: BrokerOrderRequest[]): Promise<BrokerOrderStatus[]> {
      assertTradable();
      // IBKR requires /iserver/accounts before order placement in a session.
      await call('GET', '/iserver/accounts');
      const statuses: BrokerOrderStatus[] = [];
      // One order per request, so each IBKR reply chain maps unambiguously to one order.
      for (const order of orders) {
        if (order.contract === undefined) {
          statuses.push({
            clientOrderId: order.clientOrderId,
            state: 'rejected',
            filledQuantity: 0,
            messages: [`No contract mapped for ${order.ticker}.`],
          });
          continue;
        }
        const messages: string[] = [];
        try {
          let reply: unknown = await call('POST', `/iserver/account/${accountId}/orders`, {
            orders: [
              {
                acctId: accountId,
                conid: order.contract.conid,
                cOID: order.clientOrderId,
                orderType: order.orderType,
                side: order.side,
                quantity: order.quantity,
                tif: 'DAY',
                ...(order.orderType === 'LMT' && order.limitPrice !== undefined
                  ? { price: order.limitPrice }
                  : {}),
              },
            ],
          });
          // Precautionary-message chain: [{id, message: [...]}] → POST /iserver/reply/{id}.
          for (let hop = 0; hop < 5; hop++) {
            const first = asRecord(Array.isArray(reply) ? reply[0] : reply);
            if (typeof first.id === 'string' && Array.isArray(first.message)) {
              messages.push(...first.message.map(String));
              reply = await call('POST', `/iserver/reply/${first.id}`, { confirmed: true });
              continue;
            }
            if (first.error !== undefined) {
              throw new Error(
                typeof first.error === 'string' ? first.error : JSON.stringify(first.error),
              );
            }
            statuses.push(toStatus(order.clientOrderId, first, messages));
            break;
          }
          if (statuses.at(-1)?.clientOrderId !== order.clientOrderId) {
            throw new Error('IBKR kept asking for confirmations — gave up after 5.');
          }
        } catch (error) {
          statuses.push({
            clientOrderId: order.clientOrderId,
            state: 'rejected',
            filledQuantity: 0,
            messages: [...messages, error instanceof Error ? error.message : String(error)],
          });
        }
      }
      return statuses;
    },

    async orderStatuses(clientOrderIds: string[]): Promise<BrokerOrderStatus[]> {
      const response = asRecord(await call('GET', '/iserver/account/orders?force=true'));
      const live = (Array.isArray(response.orders) ? response.orders : []).map(asRecord);
      return clientOrderIds.flatMap((clientOrderId) => {
        const match = live.find((o) => o.order_ref === clientOrderId);
        return match === undefined ? [] : [toStatus(clientOrderId, match, [])];
      });
    },

    async searchContracts(symbol: string): Promise<ContractCandidate[]> {
      const results = await call(
        'GET',
        `/iserver/secdef/search?symbol=${encodeURIComponent(symbol)}&secType=STK`,
      );
      return (Array.isArray(results) ? results : []).flatMap((r) => {
        const raw = asRecord(r);
        const conid = num(raw.conid);
        if (conid === undefined) return [];
        const sections = Array.isArray(raw.sections) ? raw.sections.map(asRecord) : [];
        const stock = sections.find((s) => s.secType === 'STK');
        return [
          {
            conid,
            symbol: typeof raw.symbol === 'string' ? raw.symbol : symbol,
            description: [raw.companyName, raw.description]
              .filter((v) => typeof v === 'string')
              .join(' — '),
            ...(typeof stock?.exchange === 'string' ? { exchange: stock.exchange } : {}),
          },
        ];
      });
    },
  };
}
