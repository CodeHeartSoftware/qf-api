import type { Migration } from '@quant-fusion/sqlite-migrations';

/** Removes "entity-almt" from "evidence-almt-iter-contract-2021"'s `entityIds` — the evidence
 * record itself stays (it's still valid support for the Sumitomo/ITER contract), it's just no
 * longer tagged as being about A.L.M.T. specifically. Evidence has no supported "edit" path
 * through the normal `apply:research-update` merge (`store/merge.ts` only defines edit semantics
 * for entities/relationships/hypotheses — any other collection refuses an id collision outright),
 * so this is a direct `UPDATE`, the same pattern `0005_walter_tosto_production_contract_retraction`
 * already established for a correction of this shape. No dangling references: `rel-almt-iter`
 * (the only relationship connecting entity-almt to this evidence's subject matter) was already
 * removed in `0060_delete_relationships_rel-almt-iter`, and no other evidence/relationship cites
 * entity-almt through this record. */
export const migration0061RemoveAlmtFromIterContractEvidence: Migration = {
  id: 'research-store/0061_remove_almt_from_iter_contract_evidence',
  sql: `
UPDATE evidence SET data = '{"id":"evidence-almt-iter-contract-2021","observedAt":"2021-01-01T00:00:00Z","source":{"name":"CONVERSATION_RESEARCH"},"description":"A.L.M.T./Sumitomo won an approximately ¥3.5B ITER tungsten monoblock contract in 2021; A.L.M.T.''s production capacity line expanded more than 8x; A.L.M.T. and a Chinese supplier reportedly produced approximately 65,000 monoblocks since October 2022, approximately half associated with A.L.M.T.","entityIds":["entity-sumitomo","entity-iter","entity-tungsten"],"metadata":{"provenanceClass":"GOVERNMENT_CLAIM"}}' WHERE dataset_id = 'dataset-fusion-2026-09' AND id = 'evidence-almt-iter-contract-2021';
UPDATE research_datasets SET version = '2026.09+update.45', updated_at = '2026-09-22T11:00:00.000Z' WHERE dataset_id = 'dataset-fusion-2026-09';
`,
};
