import type { DailyBar } from '../schema/dailyBar.js';

/**
 * Deterministic, no-LLM price ingestion primitive — fetches real daily bars from Yahoo Finance's
 * public chart API for ONE ticker. Extracted out of `scripts/fetchAndAppendBars.ts` (still this
 * package's own daily-refresh entry point) once `scripts/addNewTicker.ts` needed the identical
 * fetch/currency-validation logic for a ticker that has never been published before — same code,
 * two different callers with different "is this ticker allowed" policy around it.
 */
export interface TickerSource {
  yahooSymbol: string;
  currency: string;
  /** Multiply a native-currency price by this to get USD. A flat, single rate — NOT refreshed to
   * "today's" FX rate on every fetch, so a ticker's whole history stays internally consistent. */
  usdRate: number;
}

export interface FetchedBars {
  ticker: string;
  bars: DailyBar[];
  /** The end (Unix seconds) of TODAY's regular trading session for this ticker's exchange, per
   * Yahoo's own `meta.currentTradingPeriod.regular.end` — `undefined` only if Yahoo didn't return
   * one (defensive; hasn't been observed). Verified live against a real, currently-open session:
   * `interval=1d` does NOT null-pad an in-progress day — it returns real, live-updating OHLCV for
   * it (close = the last trade at query time, volume = cumulative so far). This field is how a
   * caller tells that LAST bar (if dated today) apart from a genuinely final one: `now >= this`
   * means the session has closed and the bar is final; `now < this` means it's still provisional.
   * Every earlier bar in `bars` is always from a fully-past, closed day regardless of this value. */
  regularSessionEndUnixSeconds?: number;
}

/** 4 decimals, not 2: after FX conversion a sub-$1 listing (FREEM trades ~$0.13) rounded to
 * cents moves in ~7% steps, which swamps its real daily returns. */
function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

function toCalendarDate(unixSeconds: number, gmtoffsetSeconds: number): string {
  // Yahoo's per-bar timestamp is the exchange's own local session time; shifting by the
  // exchange's own UTC offset before slicing (rather than slicing the raw UTC instant) gets the
  // LOCAL calendar date a naive UTC slice could get wrong right at a UTC day boundary.
  return new Date((unixSeconds + gmtoffsetSeconds) * 1000).toISOString().slice(0, 10);
}

/**
 * BACKGROUND (why this validates currency so aggressively): an earlier manual gap-fill for the
 * fusion dataset wrote several tickers' bars in their RAW native currency (JPY/KRW/SEK) instead
 * of USD, silently breaking continuity with the rest of the (USD) dataset — a ~150x price
 * discontinuity. This REFUSES to write a bar whose fetched currency doesn't match what's
 * configured, rather than silently trusting the API's response.
 */
export async function fetchTicker(
  ticker: string,
  source: TickerSource,
  sinceDate: string,
  throughDate: string,
): Promise<FetchedBars> {
  const period1 = Math.floor(new Date(`${sinceDate}T00:00:00Z`).getTime() / 1000);
  const period2 = Math.floor(new Date(`${throughDate}T23:59:59Z`).getTime() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(source.yahooSymbol)}?period1=${String(period1)}&period2=${String(period2)}&interval=1d`;
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!response.ok) {
    throw new Error(
      `${ticker}: Yahoo Finance request failed (${String(response.status)} ${response.statusText})`,
    );
  }
  const json = (await response.json()) as {
    chart: {
      result: {
        meta: {
          currency: string;
          gmtoffset: number;
          currentTradingPeriod?: { regular?: { end?: number } };
        };
        timestamp?: number[];
        indicators: {
          quote: {
            open: (number | null)[];
            high: (number | null)[];
            low: (number | null)[];
            close: (number | null)[];
            volume: (number | null)[];
          }[];
        };
      }[];
      error: unknown;
    };
  };
  const result = json.chart.result[0];
  if (result === undefined) {
    throw new Error(`${ticker}: no chart data returned (${JSON.stringify(json.chart.error)})`);
  }
  if (result.meta.currency !== source.currency) {
    throw new Error(
      `${ticker}: expected currency "${source.currency}" but Yahoo Finance reports "${result.meta.currency}" — refusing to guess a conversion.`,
    );
  }

  const timestamps = result.timestamp ?? [];
  const quote = result.indicators.quote[0];
  const bars: DailyBar[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const open = quote?.open[i];
    const high = quote?.high[i];
    const low = quote?.low[i];
    const close = quote?.close[i];
    const volume = quote?.volume[i];
    // Yahoo pads a day it has genuinely no data for at all (e.g. a future date the requested
    // range happens to include) with nulls — skip rather than fabricate. NOT the same as an
    // in-progress trading day, which comes back with real, live-updating values (see
    // `regularSessionEndUnixSeconds` above) — that case is a real bar, just a provisional one, so
    // it reaches the caller like any other and the caller decides finality.
    if (
      open === null ||
      high === null ||
      low === null ||
      close === null ||
      volume === null ||
      open === undefined ||
      high === undefined ||
      low === undefined ||
      close === undefined ||
      volume === undefined
    ) {
      continue;
    }
    const timestamp = timestamps[i];
    if (timestamp === undefined) continue; // unreachable given the loop bounds; satisfies noUncheckedIndexedAccess
    const date = toCalendarDate(timestamp, result.meta.gmtoffset);
    if (date < sinceDate) continue; // defensive; period1 already excludes these
    bars.push({
      date,
      open: round4(open * source.usdRate),
      high: round4(high * source.usdRate),
      low: round4(low * source.usdRate),
      close: round4(close * source.usdRate),
      volume: Math.round(volume),
    });
  }
  const sessionEnd = result.meta.currentTradingPeriod?.regular?.end;
  return {
    ticker,
    bars,
    ...(sessionEnd !== undefined ? { regularSessionEndUnixSeconds: sessionEnd } : {}),
  };
}
