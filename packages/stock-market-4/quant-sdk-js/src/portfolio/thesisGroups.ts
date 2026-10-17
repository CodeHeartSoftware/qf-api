/**
 * Groups tickers that share enough of their research EXPOSURE FOOTPRINT (see
 * `../research/exposure.ts`'s `exposureFootprint`) to represent the same underlying
 * commercialization bet, not genuinely independent positions (spec §20/§42 — "FREEM + GFUZ may
 * appear to be two securities but could contain substantial common exposure to the same
 * commercialization pathway"). Plain union-find over pairwise footprint overlap — no assumed/
 * hardcoded pairing, no ticker ever hardcoded as "these two are correlated"; the graph itself
 * decides, from whatever `@quant-fusion/research-fusion` currently records. A ticker with no
 * meaningful overlap with anything ends up in its own singleton group, which is a legitimate,
 * expected outcome (most of the book, most of the time), not a bug.
 */
export function groupByThesisOverlap(
  footprintByTicker: Map<string, Set<string>>,
  minSharedIds: number,
): string[][] {
  const tickers = [...footprintByTicker.keys()];
  const parent = new Map(tickers.map((t) => [t, t]));

  function find(t: string): string {
    let root = t;
    for (;;) {
      const next = parent.get(root);
      // unreachable: every value ever stored in `parent` is itself one of its own keys (the
      // union-find invariant `union` maintains) — satisfies noUncheckedIndexedAccess.
      if (next === undefined || next === root) return root;
      root = next;
    }
  }
  function union(a: string, b: string): void {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootA, rootB);
  }

  function sharedCount(a: Set<string>, b: Set<string>): number {
    let count = 0;
    for (const id of a) if (b.has(id)) count++;
    return count;
  }

  for (let i = 0; i < tickers.length; i++) {
    for (let j = i + 1; j < tickers.length; j++) {
      const tickerI = tickers[i];
      const tickerJ = tickers[j];
      if (tickerI === undefined || tickerJ === undefined) continue; // unreachable given the loop bounds; satisfies noUncheckedIndexedAccess
      const a = footprintByTicker.get(tickerI);
      const b = footprintByTicker.get(tickerJ);
      if (a === undefined || b === undefined) continue; // unreachable: tickers is built from footprintByTicker's own keys
      if (sharedCount(a, b) >= minSharedIds) union(tickerI, tickerJ);
    }
  }

  const groupsByRoot = new Map<string, string[]>();
  for (const ticker of tickers) {
    const root = find(ticker);
    const group = groupsByRoot.get(root);
    if (group === undefined) groupsByRoot.set(root, [ticker]);
    else group.push(ticker);
  }
  return [...groupsByRoot.values()];
}
