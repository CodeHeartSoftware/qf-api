/**
 * A Bear/Base/Bull scenario triple (spec §10) — never a single fake-precise forecast, and never
 * assigned probabilities the research doesn't support (spec §10, §28). Consumers that need a
 * single number pick `base` explicitly and say so in their own rationale; nothing here averages
 * or weights the three on its own.
 */
export interface ScenarioValue {
  bear: number;
  base: number;
  bull: number;
}

/**
 * A company's fair value estimate, decomposed exactly as the original fusion-fundamental spec §9
 * required, generalized to any domain: base business value (from the company's non-domain
 * operations — an assumption the bot is configured with, not something it derives), a
 * domain-derived value (from the domain's own value-chain formula — e.g. quant-v0's
 * `computeFusionValue`, revenue this domain's activity is assumed to already be producing), and a
 * domain OPTION value (a separate, smaller assumption for optionality the research doesn't yet
 * quantify — e.g. potential future contracts research hasn't confirmed). `unknowns` names every
 * quantity research does NOT establish, so nothing is silently invented — supplied by the domain
 * adapter (see `decision.ts`'s `DomainAdapter`), not hardcoded here.
 */
export interface CompanyValuation {
  ticker: string;
  asOf: string;
  baseBusinessValue: ScenarioValue;
  domainDerivedValue: ScenarioValue;
  domainOptionValue: ScenarioValue;
  fairValue: ScenarioValue;
  unknowns: string[];
}

/**
 * What the CURRENT market price already assumes about this security's domain-specific
 * opportunity, reverse-engineered by a domain adapter inverting its OWN value-chain formula for
 * whichever single assumption field is both scenario-varying and least-evidenced (e.g.
 * quant-v0 inverts `computeFusionValue` for `supplierCapture` — see that bot's own
 * `valuation/marketImplied.ts`). Generic here: this SDK has no opinion on what the inverted
 * quantity IS, only that a domain can produce one comparable "implied vs. assumed" gap.
 *
 * `undefined` when the domain's value chain is a flat zero regardless of the inverted quantity —
 * there is nothing to invert; that must be reported explicitly (not silently as a zero gap), since
 * "the market's implied value is exactly zero" and "we have no chain to invert" are different
 * findings.
 */
export interface MarketImpliedGap {
  /** The quantity (0-1, domain-defined) the current price implies, given every other `base`-
   * scenario assumption held fixed. */
  impliedValue: number;
  /** This security's OWN configured `base`-scenario value for that same quantity — what the
   * strategy itself currently believes, for direct comparison. */
  assumedValue: number;
  /** `assumedValue - impliedValue` — positive means the market is pricing in LESS domain success
   * than this strategy assumes (a potential asymmetric-upside case); negative means the market
   * already prices in MORE than this strategy assumes. */
  gap: number;
  /**
   * Whether `impliedValue` falls INSIDE or OUTSIDE the bear-to-bull range this strategy itself
   * modeled — deliberately a DIFFERENT check than `gap` (which only ever compares against the
   * single `base` assumption). `'above_bull_case'`: the market is pricing in MORE domain success
   * than even this strategy's own most optimistic scenario — a genuine caution signal (buying an
   * already-priced-in narrative regardless of price). `'below_bear_case'`: the market is pricing
   * in LESS than even this strategy's own most pessimistic scenario — the asymmetric-upside case.
   * `'within_range'`: consistent with this strategy's own modeled range — no special flag.
   */
  gapVsRange: 'within_range' | 'above_bull_case' | 'below_bear_case';
}
