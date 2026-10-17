import { exposureFootprint, type ExposureMap } from '../research/exposure.js';

/**
 * The CAUSAL half of `blended.ts`'s correlation blend (plan Phase 1, item 4): two securities that
 * share research exposure (the same reactor program, material, hypothesis, ...) are betting on the
 * same underlying commercialization pathway even before their PRICES show any statistical
 * correlation at all — e.g. two names newly added to the universe, with no shared trading history
 * yet, but an evidenced shared supplier/program relationship already on record (the same intuition
 * `fusion-fundamental-v7`'s `portfolio/optimizer.ts` thesis-group cap already acts on, reused here
 * unchanged as `../risk/riskEngine.ts`'s own concentration check — this function is a DIFFERENT,
 * continuous-valued use of the same underlying footprint, for correlation blending rather than a
 * hard group cap).
 *
 * Jaccard similarity of the two securities' `exposureFootprint` sets — 0 when either footprint is
 * empty (nothing to compare), 1 when they're identical.
 */
export function computeCausalOverlap(a: ExposureMap, b: ExposureMap): number {
  const footprintA = exposureFootprint(a);
  const footprintB = exposureFootprint(b);
  if (footprintA.size === 0 || footprintB.size === 0) return 0;

  let intersectionSize = 0;
  for (const id of footprintA) if (footprintB.has(id)) intersectionSize++;
  const unionSize = new Set([...footprintA, ...footprintB]).size;
  return unionSize === 0 ? 0 : intersectionSize / unionSize;
}
