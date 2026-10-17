/**
 * @quant-fusion/fusion-universe — the SINGLE source of truth for the 11 tracked fusion-adjacent
 * securities, shared between `@quant-fusion/research-fusion` (which needs `entityId` to compute
 * research scope) and `@quant-fusion/market-data` (which needs `yahooSymbol`/`currency`/`usdRate`
 * to fetch and convert prices). Before this package existed, the same 11-company list was hand-
 * copied in three places (research-fusion's `scope.ts`, market-data's `fetchAndAppendBars.ts`,
 * and `portfolio-research-update-skill.md`'s prose table) with no shared key between them — this
 * is the fix.
 *
 * Neither consumer's own concern leaks into the other's: `entityId` is meaningless to
 * market-data, `yahooSymbol`/`currency`/`usdRate` are meaningless to research-fusion. Both read
 * the same array and pick the fields need.
 *
 * `portfolio-research-update-skill.md`'s table stays hand-written prose (a markdown file can't
 * import a TS constant) but is documentation OF this array, not an independent copy — see that
 * file's own note. See `portfolioEntityIds.ts` for the derived entity-id-only view of this data.
 */
export interface TrackedSecurity {
  /** The trading symbol as this repo spells it (e.g. "ELMT") — matches
   * `stock-market-4`'s `marketDataUniverse` entries and `@quant-fusion/market-data`'s ticker keys. */
  ticker: string;
  /** The `@quant-fusion/research-core` entity id this security corresponds to in
   * `@quant-fusion/research-fusion`'s dataset (e.g. "entity-elmt"). */
  entityId: string;
  exchange: string;
  companyName: string;
  whatTheyDo: string;
  /** Yahoo Finance's own symbol spelling for this ticker — differs from `ticker` for every
   * non-US listing (e.g. "5801.T" for Furukawa Electric). */
  yahooSymbol: string;
  currency: string;
  /** Multiply a native-currency price by this to get USD. A flat, single rate (not refreshed to
   * "today's" FX rate) so a ticker's whole price history stays internally consistent — see
   * `@quant-fusion/market-data`'s `fetchAndAppendBars.ts` for how this is used and validated. */
  usdRate: number;
  /** `YYYY-MM-DD` — the first date this symbol's price is really THIS company's, when Yahoo's
   * history under the same symbol reaches further back (e.g. a SPAC shell trading at ~$10 before
   * the merger closes). `@quant-fusion/market-data`'s `fetchAndPublishVersion.ts` drops every bar
   * before it. Omitted means the whole Yahoo history is this company's. */
  tradingSince?: string;
}

export const TRACKED_SECURITIES: readonly TrackedSecurity[] = [
  {
    ticker: 'ELMT',
    entityId: 'entity-elmt',
    exchange: 'NASDAQ',
    companyName: 'ELMT',
    whatTheyDo: 'Tungsten, molybdenum, and specialized-alloy components',
    yahooSymbol: 'ELMT',
    currency: 'USD',
    usdRate: 1,
  },
  {
    ticker: 'FURUKAWA',
    entityId: 'entity-furukawa',
    exchange: 'TYO: 5801',
    companyName: 'Furukawa Electric',
    whatTheyDo: 'High-temperature superconducting (HTS) wire',
    yahooSymbol: '5801.T',
    currency: 'JPY',
    usdRate: 1 / 153.605,
  },
  {
    ticker: 'VITZRONEXTECH',
    entityId: 'entity-vitzro-nextech',
    exchange: 'KOSDAQ: 488900',
    companyName: 'Vitzro Nextech',
    whatTheyDo: 'Aerospace / plasma engineering components',
    yahooSymbol: '488900.KQ',
    currency: 'KRW',
    usdRate: 1 / 1386.155,
  },
  {
    ticker: 'ALM',
    entityId: 'entity-almonty',
    exchange: 'NASDAQ',
    companyName: 'Almonty Industries',
    whatTheyDo: 'Tungsten mining',
    yahooSymbol: 'ALM',
    currency: 'USD',
    usdRate: 1,
  },
  {
    ticker: 'FREEM',
    entityId: 'entity-freemelt',
    exchange: 'Nasdaq Stockholm',
    companyName: 'Freemelt',
    whatTheyDo: 'Metal 3D-printing (additive manufacturing)',
    yahooSymbol: 'FREEM.ST',
    currency: 'SEK',
    usdRate: 1 / 9.5868,
  },
  {
    ticker: 'OPTX',
    entityId: 'entity-syntec-optics',
    exchange: 'NASDAQ',
    companyName: 'Syntec Optics',
    whatTheyDo: 'Precision optics, including for fusion reactors',
    yahooSymbol: 'OPTX',
    currency: 'USD',
    usdRate: 1,
  },
  {
    ticker: 'GFUZ',
    entityId: 'entity-general-fusion',
    exchange: 'NASDAQ',
    companyName: 'General Fusion',
    whatTheyDo: 'Builds fusion reactors directly',
    yahooSymbol: 'GFUZ',
    currency: 'USD',
    usdRate: 1,
    // Yahoo's GFUZ history before this is the pre-merger SPAC shell (~$10, trust-backed), not
    // General Fusion — the business combination closed and GFUZ began trading as General Fusion
    // on 2026-07-13, the first date dataset v3 (and every price it matches exactly) starts at.
    tradingSince: '2026-07-13',
  },
  {
    ticker: 'FUJIKURA',
    entityId: 'entity-fujikura',
    exchange: 'TYO: 5803',
    companyName: 'Fujikura Ltd.',
    whatTheyDo: 'HTS wire, connectivity, and cable technology',
    yahooSymbol: '5803.T',
    currency: 'JPY',
    usdRate: 1 / 153.58,
  },
  {
    ticker: 'SUMITOMO',
    entityId: 'entity-sumitomo',
    exchange: 'TYO: 5802',
    companyName: 'Sumitomo Electric',
    whatTheyDo: 'Cable, materials, and industrial components',
    yahooSymbol: '5802.T',
    currency: 'JPY',
    usdRate: 1 / 153.58,
  },
  {
    ticker: 'KMT',
    entityId: 'entity-kennametal',
    exchange: 'NYSE',
    companyName: 'Kennametal',
    whatTheyDo: 'Tooling and wear-resistant materials',
    yahooSymbol: 'KMT',
    currency: 'USD',
    usdRate: 1,
  },
  {
    ticker: 'AMSC',
    entityId: 'entity-amsc',
    exchange: 'NASDAQ',
    companyName: 'American Superconductor',
    whatTheyDo: 'Grid-scale power electronics and superconductor tech',
    yahooSymbol: 'AMSC',
    currency: 'USD',
    usdRate: 1,
  },
];

export const TRACKED_TICKERS: ReadonlySet<string> = new Set(
  TRACKED_SECURITIES.map((s) => s.ticker),
);

export function findByTicker(ticker: string): TrackedSecurity | undefined {
  return TRACKED_SECURITIES.find((s) => s.ticker === ticker);
}

export function findByEntityId(entityId: string): TrackedSecurity | undefined {
  return TRACKED_SECURITIES.find((s) => s.entityId === entityId);
}
