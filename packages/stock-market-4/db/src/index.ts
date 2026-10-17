/**
 * @quant-fusion/stock-market-4-db — owns the ONE shared SQLite file backing all of Stock Market
 * 4's persistence (price data, research data, forward-match/portfolio data), and the full,
 * aggregated migration list that builds it. See
 * `docs/adr/0014-sqlite-standard-and-migrations.md`.
 *
 * Domain packages (`@quant-fusion/market-data`, `@quant-fusion/research-store`,
 * `@quant-fusion/forward-match-store`) keep their own query/write logic and their own migration
 * *content* — this package only owns "how do we open the one file and get every table into it."
 */
export {
  closeStockMarket4Db,
  openEphemeralStockMarket4Db,
  openStockMarket4Db,
  stockMarket4Migrations,
  type StockMarket4Db,
} from './store.js';
