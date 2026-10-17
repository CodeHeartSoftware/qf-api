/**
 * @quant-fusion/research-core — generic, domain-neutral representation of structured research
 * over time (evidence, assertions, hypotheses, models, datasets, temporal state). See README.md.
 *
 * Populated incrementally; this barrel is the only import surface consumers should use.
 */
export const RESEARCH_CORE_PACKAGE_NAME = '@quant-fusion/research-core';

export * from './validation/issue.js';

export * from './common/ids.js';
export * from './common/timestamps.js';
export * from './common/values.js';
export * from './common/confidence.js';
export * from './common/uncertainty.js';
export * from './common/quantity.js';
export * from './common/provenance.js';

export * from './entity/entity.js';

export * from './relationship/relationship-state.js';
export * from './relationship/relationship.js';

export * from './evidence/source.js';
export * from './evidence/evidence.js';

export * from './assertion/assertion.js';

export * from './hypothesis/criterion.js';
export * from './hypothesis/assessment.js';
export * from './hypothesis/hypothesis.js';

export * from './model/variable.js';
export * from './model/assumption.js';
export * from './model/calculation.js';
export * from './model/model.js';
export * from './model/scenario.js';

export * from './event/event.js';

export * from './question/question.js';

export * from './dataset/dataset.js';

export * from './validation/dataset.js';

export * from './state/state.js';
export * from './state/provider.js';

export * from './snapshot/snapshot.js';
