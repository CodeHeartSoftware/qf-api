import type { OrderSide, ProposedOrder, RiskCheck, RiskLimits } from './types.js';

/** One order exactly as the bot emitted it (`StockMarket4Action.orders[n]`). */
export interface BotOrder {
  kind: 'MARKET' | 'LIMIT';
  ticker: string;
  side: OrderSide;
  quantity: number;
  limitPrice?: number;
}

export interface RiskGateInput {
  botOrders: readonly BotOrder[];
  /** The closes the bot decided on (USD). */
  pricesUsd: Readonly<Record<string, number>>;
  /** Shares currently held, per ticker, in the bot-visible portfolio. */
  heldShares: ReadonlyMap<string, number>;
  botCashUsd: number;
  botEquityUsd: number;
  /** Minimum trading unit per ticker; `undefined` means the ticker can't be traded at all (e.g.
   * no broker contract mapped for it). */
  lotSizeByTicker: ReadonlyMap<string, number>;
  limits: RiskLimits;
  killSwitch: boolean;
  newClientOrderId: () => string;
}

function check(rule: string, ok: boolean, message: string): RiskCheck {
  return { rule, ok, message };
}

/**
 * Turns a bot's raw orders into a reviewable ticket: rounds each order to a whole lot, clamps a
 * SELL to what's actually held (never shorts a real account), then runs every limit. Any failed
 * check BLOCKS that order — it stays on the ticket so a person sees what the bot wanted, but is
 * never sent. SELLs are evaluated before BUYs so their proceeds count toward the cash check, and
 * the turnover/cash budgets are consumed in that order. Pure — no I/O — so it's fully testable.
 */
export function evaluateOrders(input: RiskGateInput): ProposedOrder[] {
  const { limits } = input;
  const ordered = [
    ...input.botOrders.filter((o) => o.side === 'SELL'),
    ...input.botOrders.filter((o) => o.side === 'BUY'),
  ];
  const turnoverBudgetUsd = (limits.maxDailyTurnoverPct / 100) * input.botEquityUsd;
  let turnoverUsedUsd = 0;
  let cashAvailableUsd = input.botCashUsd;
  // Holdings as they'll stand after every unblocked order so far — a SELL earlier in the ticket
  // frees both cash AND position weight for a later BUY of the same ticker.
  const projectedShares = new Map(input.heldShares);
  const proposed: ProposedOrder[] = [];

  for (const order of ordered) {
    const checks: RiskCheck[] = [];
    const price = input.pricesUsd[order.ticker];
    const lotSize = input.lotSizeByTicker.get(order.ticker);

    checks.push(
      check(
        'kill_switch',
        !input.killSwitch,
        input.killSwitch ? 'Kill switch is on.' : 'Kill switch off.',
      ),
    );
    checks.push(
      check(
        'contract',
        lotSize !== undefined,
        lotSize !== undefined
          ? 'Broker contract mapped.'
          : `No broker contract mapped for ${order.ticker}.`,
      ),
    );
    checks.push(
      check(
        'reference_price',
        price !== undefined && price > 0,
        price !== undefined
          ? `Reference close $${price.toFixed(2)}.`
          : `No recent price for ${order.ticker}.`,
      ),
    );

    let quantity = order.quantity;
    if (order.side === 'SELL') {
      const held = input.heldShares.get(order.ticker) ?? 0;
      if (quantity > held) {
        checks.push(
          check(
            'no_short',
            held > 0,
            held > 0
              ? `Bot asked to sell ${String(quantity)}, but only ${String(held)} held — clamped.`
              : 'Nothing held to sell (short selling is never sent to a real account).',
          ),
        );
        quantity = held;
      }
    }
    const lot = lotSize ?? 1;
    // A full exit of an odd-lot holding is still allowed; anything else rounds down to whole lots.
    const isFullExit =
      order.side === 'SELL' && quantity === (input.heldShares.get(order.ticker) ?? 0);
    const rounded = isFullExit ? quantity : Math.floor(quantity / lot) * lot;
    if (rounded !== quantity) {
      checks.push(
        check(
          'lot_size',
          rounded > 0,
          rounded > 0
            ? `Rounded ${String(quantity)} down to ${String(rounded)} (lot size ${String(lot)}).`
            : `${String(quantity)} shares is below one lot (${String(lot)}).`,
        ),
      );
    }
    quantity = rounded;

    const notional = quantity * (price ?? 0);
    checks.push(
      check(
        'max_order_notional',
        notional <= limits.maxOrderNotionalUsd,
        `Notional $${notional.toFixed(0)} vs limit $${limits.maxOrderNotionalUsd.toFixed(0)}.`,
      ),
    );

    if (order.side === 'BUY') {
      const heldValue = (projectedShares.get(order.ticker) ?? 0) * (price ?? 0);
      const weightPct =
        input.botEquityUsd > 0 ? ((heldValue + notional) / input.botEquityUsd) * 100 : Infinity;
      checks.push(
        check(
          'max_position_weight',
          weightPct <= limits.maxPositionWeightPct,
          `Post-trade weight ${weightPct.toFixed(1)}% vs limit ${String(limits.maxPositionWeightPct)}%.`,
        ),
      );
      checks.push(
        check(
          'cash',
          notional <= cashAvailableUsd + 1e-6,
          `Needs $${notional.toFixed(0)}, $${Math.max(0, cashAvailableUsd).toFixed(0)} available.`,
        ),
      );
    }
    checks.push(
      check(
        'max_turnover',
        turnoverUsedUsd + notional <= turnoverBudgetUsd + 1e-6,
        `Ticket turnover would reach $${(turnoverUsedUsd + notional).toFixed(0)} of $${turnoverBudgetUsd.toFixed(0)} allowed.`,
      ),
    );

    const blocked = quantity <= 0 || checks.some((c) => !c.ok);
    if (!blocked) {
      turnoverUsedUsd += notional;
      cashAvailableUsd += order.side === 'SELL' ? notional : -notional;
      projectedShares.set(
        order.ticker,
        (projectedShares.get(order.ticker) ?? 0) + (order.side === 'SELL' ? -quantity : quantity),
      );
    }
    proposed.push({
      clientOrderId: input.newClientOrderId(),
      ticker: order.ticker,
      side: order.side,
      requestedQuantity: order.quantity,
      quantity,
      orderType: order.kind === 'LIMIT' ? 'LMT' : 'MKT',
      ...(order.kind === 'LIMIT' && order.limitPrice !== undefined
        ? { limitPriceUsd: order.limitPrice }
        : {}),
      referencePriceUsd: price ?? 0,
      notionalUsd: notional,
      checks,
      blocked,
    });
  }
  return proposed;
}
