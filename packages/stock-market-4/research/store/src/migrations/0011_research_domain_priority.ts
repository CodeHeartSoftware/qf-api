import type { Migration } from '@quant-fusion/sqlite-migrations';

/**
 * A domain's sidebar display order — higher number shown first, `0` (the column's own default
 * for any domain created before or without one specified) last. Lives on `research_datasets`
 * itself, not `@thunderdome/research-core`'s `ResearchDataset` schema: like `tracked_tickers`,
 * this is app-level registry/presentation metadata ("where does this domain sort"), never research
 * content, so it never flows through `computeResearchStateAt`/snapshots/etc.
 *
 * Sets the two existing domains' real priorities explicitly in the same migration that adds the
 * column, rather than leaving them at the default and needing a second one: fusion is the actual,
 * substantially-populated research domain this whole app was built around; quantum is an
 * intentional skeleton (see its own README) that should read as secondary in the sidebar, not
 * competing for top billing.
 */
export const migration0011ResearchDomainPriority: Migration = {
  id: 'research-store/0011_research_domain_priority',
  sql: `
ALTER TABLE research_datasets ADD COLUMN priority INTEGER NOT NULL DEFAULT 0;
UPDATE research_datasets SET priority = 100 WHERE dataset_id = 'dataset-fusion-2026-09';
UPDATE research_datasets SET priority = 10 WHERE dataset_id = 'dataset-quantum-skeleton';
`,
};
