import type { Migration } from '@quant-fusion/sqlite-migrations';

/** Retracts the "Walter Tosto wins a 2029 production contract" event/evidence/relationship-state
 * seeded in `0002_fusion_seed` — it was mocked fixture data (never a real public disclosure) that
 * only existed to exercise `research-core`'s point-in-time snapshot behavior; that coverage now
 * lives on the ELMT/ams OSRAM acquisition case instead (a real event), so this fabricated one is
 * removed rather than corrected in place. A previously-applied migration must never be edited —
 * see `0002_fusion_seed`'s own doc comment — so this undoes it as a new migration instead. */
export const migration0005WalterTostoProductionContractRetraction: Migration = {
  id: 'research-store/0005_walter_tosto_production_contract_retraction',
  sql: `
DELETE FROM events WHERE dataset_id = 'dataset-fusion-2026-09' AND id = 'event-walter-tosto-production-contract';
DELETE FROM evidence WHERE dataset_id = 'dataset-fusion-2026-09' AND id = 'evidence-walter-tosto-production-contract';
UPDATE relationships SET data = '{"id":"rel-walter-tosto-sparc","type":"supplies","fromEntityId":"entity-walter-tosto","toEntityId":"entity-sparc","states":[{"status":"tested","recordedAt":"2024-01-01T00:00:00Z","effectiveFrom":"2023-06-01T00:00:00Z","effectiveTo":"2025-01-01T00:00:00Z","evidenceIds":["evidence-walter-tosto-vessel"],"confidence":{"value":0.6,"basis":"early fabrication-capability disclosure"}},{"status":"qualified","recordedAt":"2025-06-01T00:00:00Z","effectiveFrom":"2025-01-01T00:00:00Z","evidenceIds":["evidence-walter-tosto-vessel"],"confidence":{"value":0.85}}]}' WHERE dataset_id = 'dataset-fusion-2026-09' AND id = 'rel-walter-tosto-sparc';
UPDATE research_datasets SET version = '2026.09+update.3', updated_at = '2026-09-17T00:00:00Z' WHERE dataset_id = 'dataset-fusion-2026-09';
`,
};
