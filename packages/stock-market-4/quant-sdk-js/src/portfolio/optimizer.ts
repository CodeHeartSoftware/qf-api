import { groupByThesisOverlap } from './thesisGroups.js';

export interface ThesisGroupCapPolicy {
  /** Two securities are treated as the same commercialization bet once their exposure
   * footprints (`../research/exposure.ts`) share at least this many entity/hypothesis ids. */
  minSharedExposureIds: number;
  /** Max COMBINED |targetWeight| across every member of one thesis group — the real, new
   * portfolio-level capability (spec §20): independent per-security sizing never sees this, only
   * this optimizer pass, which is the one place with visibility into the whole book's exposure at
   * once. */
  maxGroupWeight: number;
}

export interface ThesisGroupAdjustment {
  group: string[];
  sharedExposureIds: string[];
  combinedWeightBefore: number;
  scaleFactor: number;
  note: string;
}

export interface ThesisGroupCapResult {
  adjustedWeightByTicker: Map<string, number | undefined>;
  /** One entry per group that actually got scaled down — empty when nothing overlapped enough to
   * exceed the cap, which is the common case and not itself a finding worth reporting louder than
   * "nothing to adjust." */
  adjustments: ThesisGroupAdjustment[];
}

/**
 * The portfolio-level pass spec §20/§25 asks for: takes each security's OWN, independently-sized
 * target weight (everything upstream of this — signal, valuation gap, correlation/volatility/
 * trend/stop-loss scaling — stays exactly as-is, per-security) and, ONLY where two or more
 * securities share enough research exposure to represent one underlying bet, scales the WHOLE
 * group down proportionally so their combined exposure respects `policy.maxGroupWeight`. A
 * security's own action can therefore differ from what its raw signal alone would produce (spec
 * §25) — explicitly captured in `adjustments`, not silently absorbed into the final number.
 *
 * Never scales a group UP, and never touches a group whose combined weight is already within the
 * cap — this only ever reduces concentration, it does not redistribute freed-up weight to anything
 * else (that would be reintroducing exactly the kind of allocator spec §27's predecessor bots
 * deliberately avoided; this optimizer's own job is strictly "don't double-count one bet," nothing
 * more).
 */
export function applyThesisGroupCaps(params: {
  targetWeightByTicker: Map<string, number | undefined>;
  exposureFootprintByTicker: Map<string, Set<string>>;
  policy: ThesisGroupCapPolicy;
}): ThesisGroupCapResult {
  const groups = groupByThesisOverlap(
    params.exposureFootprintByTicker,
    params.policy.minSharedExposureIds,
  );
  const adjustedWeightByTicker = new Map(params.targetWeightByTicker);
  const adjustments: ThesisGroupAdjustment[] = [];

  for (const group of groups) {
    if (group.length < 2) continue; // a singleton has nothing to double-count against

    const combinedWeightBefore = group.reduce(
      (sum, ticker) => sum + Math.abs(params.targetWeightByTicker.get(ticker) ?? 0),
      0,
    );
    if (combinedWeightBefore <= params.policy.maxGroupWeight) continue;

    const scaleFactor = params.policy.maxGroupWeight / combinedWeightBefore;
    for (const ticker of group) {
      const weight = params.targetWeightByTicker.get(ticker);
      if (weight === undefined) continue;
      adjustedWeightByTicker.set(ticker, weight * scaleFactor);
    }

    let sharedExposureIds: string[] = [];
    const firstTicker = group[0];
    for (let i = 1; i < group.length && firstTicker !== undefined; i++) {
      const otherTicker = group[i];
      if (otherTicker === undefined) continue; // unreachable given the loop bounds; satisfies noUncheckedIndexedAccess
      const a = params.exposureFootprintByTicker.get(firstTicker) ?? new Set<string>();
      const b = params.exposureFootprintByTicker.get(otherTicker) ?? new Set<string>();
      sharedExposureIds = [...a].filter((id) => b.has(id));
    }

    adjustments.push({
      group,
      sharedExposureIds,
      combinedWeightBefore,
      scaleFactor,
      note:
        `${group.join(', ')} share ${String(sharedExposureIds.length)} exposure id(s) ` +
        `(${sharedExposureIds.slice(0, 5).join(', ')}${sharedExposureIds.length > 5 ? ', ...' : ''}) — ` +
        `treated as one commercialization bet. Combined raw target weight ` +
        `${(combinedWeightBefore * 100).toFixed(1)}% exceeded the ${(params.policy.maxGroupWeight * 100).toFixed(1)}% ` +
        `group cap; every member scaled by ${(scaleFactor * 100).toFixed(0)}%.`,
    });
  }

  return { adjustedWeightByTicker, adjustments };
}
