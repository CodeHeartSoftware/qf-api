/**
 * The common shape EVERY independent alpha signal produces (plan: "multiple independent alpha
 * signals combined via measured information coefficients, never hand-picked weights") — nothing
 * downstream (ic.ts's ensemble combiner, ablation.ts's filter) needs to know which factor produced
 * a signal, only this shape.
 */
export interface AlphaSignal {
  /** Stable factor name — 'evidence_delta' | 'commercialization' | 'valuation_gap' |
   * 'market_implied' | 'momentum' in this bot, but callers/tests should treat it as an opaque
   * string key, not a closed enum, so a new alpha can be added without touching this file. */
  factor: string;
  ticker: string;
  date: string | null;
  /** A signed, expected-return-like quantity (roughly: "fraction of price this factor implies the
   * security should move"), NOT yet weighted by confidence — see `ic.ts`'s `combineAlphaEnsemble`
   * for where confidence and the measured IC-derived factor weight both get folded in. */
  value: number;
  /** 0-1, this factor's own belief in `value` this round — independent of the ensemble weight
   * `ic.ts` assigns the FACTOR as a whole across history. `0` means "present but inert this round"
   * (e.g. no relevant research change fired) — see `ablation.ts`, which drops factors entirely
   * rather than relying on a caller noticing a zero confidence. */
  confidence: number;
}
