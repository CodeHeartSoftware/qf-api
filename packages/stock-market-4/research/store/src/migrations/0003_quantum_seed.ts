import type { Migration } from '@quant-fusion/sqlite-migrations';

/**
 * The quantum research skeleton dataset, generated from what used to be
 * `createQuantumSkeletonDataset()`'s inline TypeScript construction — see
 * `research/quantum/scripts/generateQuantumSeedMigration.ts`. Every research update from
 * here on lands as its own later migration, never an edit to this one.
 */
export const migration0003QuantumSeed: Migration = {
  id: 'research-store/0003_quantum_seed',
  sql: `
INSERT INTO research_datasets (dataset_id, domain, name, version, created_at, updated_at, metadata) VALUES ('dataset-quantum-skeleton', 'quantum', 'Quantum Research (skeleton)', '0.1.0', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL);
INSERT INTO entities (dataset_id, id, ordinal, type, name, recorded_at, data) VALUES ('dataset-quantum-skeleton', 'entity-ibm-quantum', 0, 'company', 'IBM Quantum', '2026-01-01T00:00:00Z', '{"id":"entity-ibm-quantum","type":"company","name":"IBM Quantum","recordedAt":"2026-01-01T00:00:00Z"}');
INSERT INTO entities (dataset_id, id, ordinal, type, name, recorded_at, data) VALUES ('dataset-quantum-skeleton', 'entity-superconducting-qubit', 1, 'quantum-architecture', 'Superconducting Qubit', '2026-01-01T00:00:00Z', '{"id":"entity-superconducting-qubit","type":"quantum-architecture","name":"Superconducting Qubit","recordedAt":"2026-01-01T00:00:00Z"}');
INSERT INTO entities (dataset_id, id, ordinal, type, name, recorded_at, data) VALUES ('dataset-quantum-skeleton', 'entity-surface-code', 2, 'error-correction-code', 'Surface Code', '2026-01-01T00:00:00Z', '{"id":"entity-surface-code","type":"error-correction-code","name":"Surface Code","recordedAt":"2026-01-01T00:00:00Z"}');
INSERT INTO relationships (dataset_id, id, ordinal, type, from_entity_id, to_entity_id, data) VALUES ('dataset-quantum-skeleton', 'rel-ibm-quantum-uses-superconducting-qubit', 0, 'uses', 'entity-ibm-quantum', 'entity-superconducting-qubit', '{"id":"rel-ibm-quantum-uses-superconducting-qubit","type":"uses","fromEntityId":"entity-ibm-quantum","toEntityId":"entity-superconducting-qubit","states":[{"status":"active","recordedAt":"2026-01-01T00:00:00Z","effectiveFrom":"2026-01-01T00:00:00Z","evidenceIds":["evidence-ibm-surface-code-results"]}]}');
INSERT INTO evidence (dataset_id, id, ordinal, observed_at, data) VALUES ('dataset-quantum-skeleton', 'evidence-ibm-surface-code-results', 0, '2026-01-01T00:00:00Z', '{"id":"evidence-ibm-surface-code-results","observedAt":"2026-01-01T00:00:00Z","source":{"name":"IBM Quantum publication"},"description":"IBM Quantum published surface-code error-correction results on a superconducting-qubit platform.","entityIds":["entity-ibm-quantum","entity-superconducting-qubit","entity-surface-code"]}');
INSERT INTO hypotheses (dataset_id, id, ordinal, name, status, created_at, data) VALUES ('dataset-quantum-skeleton', 'hypothesis-surface-code-necessary', 0, 'Surface-code necessity', 'active', '2026-01-01T00:00:00Z', '{"id":"hypothesis-surface-code-necessary","name":"Surface-code necessity","statement":"Surface-code error correction is necessary for fault-tolerant quantum computing at scale.","status":"active","createdAt":"2026-01-01T00:00:00Z","assessments":[{"timestamp":"2026-01-01T00:00:00Z","confidence":{"value":0.7},"supportingEvidenceIds":["evidence-ibm-surface-code-results"],"contradictingEvidenceIds":[]}]}');
`,
};
