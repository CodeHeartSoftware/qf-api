# @quant-fusion/fusion-universe

The SINGLE source of truth for the 11 tracked fusion-adjacent securities — shared between
[`@quant-fusion/research-fusion`](../research/fusion/README.md) (which needs each security's
research-core `entityId` to compute research scope) and
[`@quant-fusion/market-data`](../market-data/README.md) (which needs each security's `yahooSymbol`/
`currency`/`usdRate` to fetch and convert real daily prices).

Before this package existed, the same 11-company list was hand-copied in three places —
`research-fusion`'s `scope.ts`, `market-data`'s `fetchAndAppendBars.ts`, and
`portfolio-research-update-skill.md`'s prose table — with no shared key between them at all (a
ticker string in one place, a research entity id in another, never linked). This package is the
fix: one array, one row per company, every consumer reads the same data and picks the fields it
needs.

## What's in it

- **`src/trackedSecurities.ts`** — the `TrackedSecurity` interface and the `TRACKED_SECURITIES`
  array itself: `ticker`, `entityId`, `exchange`, `companyName`, `whatTheyDo`, `yahooSymbol`,
  `currency`, `usdRate` (a flat, single conversion rate — not refreshed to "today's" FX rate on
  every run, so a ticker's whole price history stays internally consistent). Also
  `TRACKED_TICKERS`, `findByTicker`, `findByEntityId`.
- **`src/portfolioEntityIds.ts`** — just `PORTFOLIO_ENTITY_IDS`, the entity-id-only view derived
  from `TRACKED_SECURITIES`. Split into its own file because `research-fusion`'s `scope.ts` (and
  everything built on it — the ecosystem/portfolio research split) only ever needs this narrow
  view, never the market-data-specific fields.
- **`src/index.ts`** — a two-line barrel re-exporting both.

Neither consumer's own concern leaks into the other's: `entityId` is meaningless to `market-data`;
`yahooSymbol`/`currency`/`usdRate` are meaningless to `research-fusion`.

## Who actually reads this

- `research-fusion/src/scope.ts` imports `PORTFOLIO_ENTITY_IDS` directly (and re-exports it, so
  existing importers of `research-fusion`'s own `PORTFOLIO_ENTITY_IDS` don't need to change).
- `market-data/scripts/fetchAndAppendBars.ts` derives its `TICKERS` map (Yahoo symbol/currency/
  rate per ticker) from `TRACKED_SECURITIES` instead of a second hand-copied table.
- `research-fusion/scripts/emitForwardMatchConfig.ts` defaults a forward match's `--universe` to
  `TRACKED_SECURITIES`'s own ticker order when none is given, instead of requiring it be
  hand-typed on every invocation.
- `portfolio-research-update-skill.md`'s tracked-universe table is prose documentation OF this
  package's data, not an independent copy — if the two ever disagree, this package wins.

## The one place this can't reach: bots

`bots/stock-market-4/quant-v0`'s own `src/research/interpretEvents.ts` hand-copies a
`PORTFOLIO_ENTITY_IDS`-equivalent constant rather than importing this package, because `bots/**`
is deliberately not a Yarn workspace member (`docs/adr/0001-monorepo-and-boundary.md`) — shipped
bot code has no way to depend on an internal package except vendoring (see
`@quant-fusion/quant-sdk-js`'s own README for that mechanism), and this package hasn't been vendored
into any bot. That hand-copy is a documented, deliberate exception, not an oversight — keep it in
sync with `TRACKED_SECURITIES` if that set ever changes.

## Testing

`yarn workspace @quant-fusion/fusion-universe test` — validates the invariants both consumers rely
on: exactly 11 entries, no duplicate tickers/entity ids, every entity id follows the
`entity-<slug>` convention, `usdRate` is exactly `1` for USD tickers and a real positive factor
otherwise, and the two derived sets (`PORTFOLIO_ENTITY_IDS`, `TRACKED_TICKERS`) stay in sync with
the source array.
